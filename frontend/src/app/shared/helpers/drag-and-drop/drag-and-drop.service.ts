//-- copyright
// OpenProject is an open source project management software.
// Copyright (C) the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See COPYRIGHT and LICENSE files for more details.
//++

import { DOCUMENT, Injectable, OnDestroy, inject } from '@angular/core';
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { preventUnhandled } from '@atlaskit/pragmatic-drag-and-drop/prevent-unhandled';
import { findIndex, reinsert } from 'core-app/shared/helpers/drag-and-drop/drag-and-drop.helpers';
import {
  type Edge,
  attachClosestEdge,
  extractClosestEdge,
} from 'core-common/drag-and-drop/reorder';
import { clearDropIndicator, renderDropIndicator } from 'core-common/drag-and-drop/drop-indicator';
import { registerAutoScroll } from 'core-common/drag-and-drop/auto-scroll';

export interface DragMember {
  dragContainer:HTMLElement;
  scrollContainers:HTMLElement[];
  /** Whether this element may start a drag (handle = element under the pointer) */
  moves:(element:HTMLElement, fromContainer:HTMLElement, handle:HTMLElement, sibling?:HTMLElement|null) => boolean;
  /** Element was reordered within this container */
  onMoved:(element:HTMLElement, target:HTMLElement, source:HTMLElement, sibling:HTMLElement|null) => void;
  /** Element arrived from another container; resolve false to reject the move */
  onAdded:(element:HTMLElement, target:HTMLElement, source:HTMLElement, sibling:HTMLElement|null) => Promise<boolean>;
  /** Element left this container after a successful cross-container move */
  onRemoved:(element:HTMLElement, target:HTMLElement, source:HTMLElement, sibling:HTMLElement|null) => void;
  /** Whether this container accepts the dragged element */
  accepts?:(element:HTMLElement, container:HTMLElement) => boolean;
  /** A drag started on an element of this container */
  onDragStarted?:(element:HTMLElement) => void;
  /** The custom native drag preview was rendered (style it here) */
  onPreviewRendered?:(preview:HTMLElement, original:HTMLElement) => void;
  /** The drag ended outside any registered container */
  onCancel?:(element:HTMLElement) => void;
}

type CleanupFn = () => void;

interface Registration {
  member:DragMember;
  cleanups:CleanupFn[];
  childCleanups:Map<HTMLElement, CleanupFn>;
  observer:MutationObserver;
}

interface DropTargetRecord {
  element:Element;
  data:Record<string|symbol, unknown>;
}

const allowedEdges:Edge[] = ['top', 'bottom'];

@Injectable()
export class DragAndDropService implements OnDestroy {
  private document = inject<Document>(DOCUMENT);

  private registrations = new Map<HTMLElement, Registration>();

  private scrollCleanups:CleanupFn[] = [];

  private monitorCleanup:CleanupFn|null = null;

  // Payload markers. Symbol keys keep this service's drags from cross-firing
  // other Pragmatic adapters' monitors (autocompleter, sortable lists).
  // Instance-scoped (not module-level) so two coexisting service instances
  // never accept each other's drags. The two distinct keys let drop
  // resolution tell a row target from a container target.
  private readonly dragItemKey = Symbol('op-drag-and-drop-item');

  private readonly dragContainerKey = Symbol('op-drag-and-drop-container');

  private dragItemData = ():Record<string|symbol, unknown> => ({ [this.dragItemKey]: true });

  private dragContainerData = ():Record<string|symbol, unknown> => ({ [this.dragContainerKey]: true });

  private isDragItemData = (data:Record<string|symbol, unknown>):boolean => data[this.dragItemKey] === true;

  private isDragContainerData = (data:Record<string|symbol, unknown>):boolean => data[this.dragContainerKey] === true;

  ngOnDestroy():void {
    Array.from(this.registrations.keys()).forEach((container) => this.remove(container));
    this.scrollCleanups.forEach((cleanup) => cleanup());
    this.scrollCleanups = [];
    this.monitorCleanup?.();
    this.monitorCleanup = null;
  }

  public register(member:DragMember):void {
    const { dragContainer } = member;
    if (this.registrations.has(dragContainer)) {
      return;
    }

    this.ensureMonitor();

    const cleanups:CleanupFn[] = [];

    // Container-level drop target: validates acceptance, highlights the drop
    // zone, and catches drops into the empty space below the rows.
    cleanups.push(dropTargetForElements({
      element: dragContainer,
      canDrop: ({ source }) => this.isDragItemData(source.data) && this.accepts(member, source.element, dragContainer),
      getData: () => this.dragContainerData(),
      onDragEnter: () => this.toggleDropZone(dragContainer, true),
      onDragLeave: () => this.toggleDropZone(dragContainer, false),
      onDrop: () => this.toggleDropZone(dragContainer, false),
    }));

    member.scrollContainers.forEach((element) => {
      cleanups.push(registerAutoScroll({
        element,
        canScroll: ({ source }) => this.isDragItemData(source.data),
      }));
    });

    // Consumers re-render rows wholesale (fast-table rebuilds, ngFor
    // re-creates), so per-row Pragmatic registrations are synced from DOM
    // mutations — the same mechanism Stimulus uses to connect sortable-lists
    // item controllers.
    const observer = new MutationObserver(() => this.syncChildren(dragContainer));

    this.registrations.set(dragContainer, {
      member,
      cleanups,
      childCleanups: new Map(),
      observer,
    });

    this.syncChildren(dragContainer);
    observer.observe(dragContainer, { childList: true });
  }

  public remove(container:HTMLElement):void {
    const registration = this.registrations.get(container);
    if (!registration) {
      return;
    }

    registration.observer.disconnect();
    registration.childCleanups.forEach((cleanup) => cleanup());
    registration.cleanups.forEach((cleanup) => cleanup());
    this.registrations.delete(container);
  }

  public member(container:HTMLElement):DragMember|undefined {
    return this.registrations.get(container)?.member;
  }

  public addScrollContainer(element:Element):void {
    this.scrollCleanups.push(registerAutoScroll({
      element,
      canScroll: ({ source }) => this.isDragItemData(source.data),
      // Unlike the per-member scrollContainers (which only ever scroll the
      // vertical list body), this is also used for containers that scroll
      // horizontally (e.g. the boards list), so both axes must be allowed.
      axis: 'all',
    }));
  }

  private ensureMonitor():void {
    if (this.monitorCleanup) {
      return;
    }

    this.monitorCleanup = monitorForElements({
      canMonitor: ({ source }) => this.isDragItemData(source.data),
      onDrop: ({ source, location }) => {
        preventUnhandled.stop();
        this.handleDrop(source.element, location.current.dropTargets);
      },
    });
  }

  private syncChildren(container:HTMLElement):void {
    const registration = this.registrations.get(container);
    if (!registration) {
      return;
    }

    const desired = Array.from(container.children)
      .filter((child):child is HTMLElement => child instanceof HTMLElement);
    const desiredSet = new Set<HTMLElement>(desired);

    registration.childCleanups.forEach((cleanup, element) => {
      if (!desiredSet.has(element)) {
        cleanup();
        registration.childCleanups.delete(element);
      }
    });

    desired.forEach((element) => {
      if (!registration.childCleanups.has(element)) {
        registration.childCleanups.set(element, this.registerChild(element, container, registration.member));
      }
    });
  }

  private registerChild(element:HTMLElement, container:HTMLElement, member:DragMember):CleanupFn {
    return combine(
      draggable({
        element,
        canDrag: ({ input }) => member.moves(
          element,
          container,
          this.handleFromPoint(input.clientX, input.clientY, element),
          null,
        ),
        getInitialData: () => this.dragItemData(),
        onDragStart: () => {
          preventUnhandled.start();
          element.dataset.sourceIndex = findIndex(element).toString();
          member.onDragStarted?.(element);
        },
        onGenerateDragPreview: member.onPreviewRendered
          ? ({ nativeSetDragImage }) => {
            setCustomNativeDragPreview({
              nativeSetDragImage,
              render: ({ container: previewContainer }) => {
                previewContainer.classList.add('op-drag-preview');
                const preview = element.cloneNode(true) as HTMLElement;
                previewContainer.appendChild(preview);
                member.onPreviewRendered?.(preview, element);
                return () => undefined;
              },
            });
          }
          : undefined,
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => this.isDragItemData(source.data) && this.accepts(member, source.element, container),
        getData: ({ input }) => attachClosestEdge(this.dragItemData(), { element, input, allowedEdges }),
        getIsSticky: () => true,
        onDragEnter: ({ self }) => renderDropIndicator(element, extractClosestEdge(self.data)),
        onDrag: ({ self }) => renderDropIndicator(element, extractClosestEdge(self.data)),
        onDragLeave: () => clearDropIndicator(element),
        onDrop: () => clearDropIndicator(element),
      }),
    );
  }

  private handleDrop(element:HTMLElement, dropTargets:DropTargetRecord[]):void {
    const fromContainer = this.containerOf(element);
    const from = fromContainer ? this.registrations.get(fromContainer)?.member : undefined;
    if (!fromContainer || !from) {
      return;
    }

    const itemTarget = dropTargets.find((target) => this.isDragItemData(target.data));
    const containerTarget = dropTargets.find((target) => this.isDragContainerData(target.data));

    const toContainer = (itemTarget && this.containerOf(itemTarget.element))
      ?? (containerTarget?.element as HTMLElement|undefined)
      ?? null;
    const to = toContainer ? this.registrations.get(toContainer)?.member : undefined;

    if (!toContainer || !to) {
      // Ended outside any registered container: nothing moved.
      from.onCancel?.(element);
      return;
    }

    const edge = itemTarget ? extractClosestEdge(itemTarget.data) : null;
    const targetItem = itemTarget && itemTarget.element !== element
      ? itemTarget.element as HTMLElement
      : null;
    const sibling = this.placeElement(element, toContainer, targetItem, edge);

    if (toContainer !== fromContainer) {
      // The two containers' MutationObserver callbacks would otherwise fire
      // as separate, nondeterministically ordered microtasks, and Pragmatic
      // warns about a transient duplicate registration if the target
      // container registers the element before the source container
      // releases its stale one. Syncing synchronously here (idempotent, so
      // the later observer callbacks are harmless) makes the release happen
      // before the target's registration.
      this.syncChildren(fromContainer);
      this.syncChildren(toContainer);
    }

    void this.dispatchDrop({
      element, from, to, fromContainer, toContainer, sibling,
    });
  }

  // Physically relocate the dragged node before invoking callbacks, so they
  // read the post-move DOM exactly as they did under dragula. Returns the
  // resulting next sibling (dragula's `sibling` argument).
  private placeElement(
    element:HTMLElement,
    toContainer:HTMLElement,
    targetItem:HTMLElement|null,
    edge:Edge|null,
  ):HTMLElement|null {
    let reference:Element|null;
    if (targetItem) {
      reference = edge === 'bottom' ? targetItem.nextElementSibling : targetItem;
    } else {
      // Dropped onto itself or into container space: keep the current spot
      // within the same container, append when arriving from another one.
      reference = this.containerOf(element) === toContainer ? element.nextElementSibling : null;
    }

    if (reference === element) {
      reference = element.nextElementSibling;
    }

    toContainer.insertBefore(element, reference);

    return element.nextElementSibling as HTMLElement|null;
  }

  private async dispatchDrop({
    element, from, to, fromContainer, toContainer, sibling,
  }:{
    element:HTMLElement;
    from:DragMember;
    to:DragMember;
    fromContainer:HTMLElement;
    toContainer:HTMLElement;
    sibling:HTMLElement|null;
  }):Promise<void> {
    if (to === from) {
      to.onMoved(element, toContainer, fromContainer, sibling);
      return;
    }

    try {
      const added = await to.onAdded(element, toContainer, fromContainer, sibling);
      if (added) {
        from.onRemoved(element, toContainer, fromContainer, sibling);
      } else {
        this.revertCrossContainerMove(element, fromContainer, toContainer);
      }
    } catch (e) {
      console.error('Failed to handle drop of %O, %O', element, e);
      this.revertCrossContainerMove(element, fromContainer, toContainer);
    }
  }

  // Restore a rejected cross-container move, then settle both containers'
  // registrations synchronously — the mirror of the settling in handleDrop:
  // this time the target container releases the stale registration and the
  // source container re-registers.
  private revertCrossContainerMove(
    element:HTMLElement,
    fromContainer:HTMLElement,
    toContainer:HTMLElement,
  ):void {
    reinsert(element, element.dataset.sourceIndex ?? -1, fromContainer);
    this.syncChildren(toContainer);
    this.syncChildren(fromContainer);
  }

  private accepts(member:DragMember, source:HTMLElement, container:HTMLElement):boolean {
    return member.accepts ? member.accepts(source, container) : true;
  }

  // Reproduce dragula's `handle` argument: the element under the pointer when
  // the drag begins, so member.moves() can gate on a drag handle.
  private handleFromPoint(x:number, y:number, fallback:HTMLElement):HTMLElement {
    const handle = this.document.elementFromPoint(x, y);
    return handle instanceof HTMLElement ? handle : fallback;
  }

  private containerOf(element:Element):HTMLElement|null {
    let node = element.parentElement;
    while (node) {
      if (this.registrations.has(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  private toggleDropZone(container:HTMLElement, active:boolean):void {
    const zone = container.closest('.drop-zone');
    if (zone) {
      zone.classList.toggle('-dragged-over', active);
    }
  }
}
