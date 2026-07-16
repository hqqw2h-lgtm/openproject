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

import { TestBed } from '@angular/core/testing';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { DragAndDropService, DragMember } from './drag-and-drop.service';
import { nativeDrag, settle } from './drag-simulation.spec-helper';

export function buildList(rowCount:number, idPrefix:string):HTMLElement {
  const container = document.createElement('div');
  container.style.width = '200px';
  for (let i = 0; i < rowCount; i += 1) {
    const row = document.createElement('div');
    row.dataset.id = `${idPrefix}${i}`;
    row.style.height = '20px';
    row.textContent = `${idPrefix}${i}`;
    container.appendChild(row);
  }
  document.body.appendChild(container);
  return container;
}

export function buildMember(container:HTMLElement, overrides:Partial<DragMember> = {}):DragMember {
  return {
    dragContainer: container,
    scrollContainers: [],
    moves: vi.fn(() => true),
    onMoved: vi.fn(),
    onAdded: vi.fn(() => Promise.resolve(true)),
    onRemoved: vi.fn(),
    ...overrides,
  };
}

export function rowIds(container:HTMLElement):string[] {
  return Array.from(container.children).map((child) => (child as HTMLElement).dataset.id!);
}

describe('DragAndDropService', () => {
  let service:DragAndDropService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DragAndDropService] });
    service = TestBed.inject(DragAndDropService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    document.body.innerHTML = '';
  });

  describe('registration and child sync', () => {
    it('makes direct children draggable on register', async () => {
      const container = buildList(3, 'a');
      service.register(buildMember(container));
      await settle();

      expect(Array.from(container.children).every((child) => (child as HTMLElement).draggable)).toBe(true);
    });

    it('registers rows added after register and releases removed rows', async () => {
      const container = buildList(1, 'a');
      service.register(buildMember(container));
      await settle();

      const late = document.createElement('div');
      late.dataset.id = 'late';
      late.style.height = '20px';
      container.appendChild(late);
      await settle();
      expect(late.draggable).toBe(true);

      container.removeChild(late);
      await settle();
      expect(late.draggable).toBe(false);
    });

    it('stops tracking a container after remove()', async () => {
      const container = buildList(1, 'a');
      const member = buildMember(container);
      service.register(member);
      await settle();

      service.remove(container);
      expect(service.member(container)).toBeUndefined();

      const late = document.createElement('div');
      container.appendChild(late);
      await settle();
      expect(late.draggable).toBe(false);
    });

    it('returns the registered member for a container', () => {
      const container = buildList(1, 'a');
      const member = buildMember(container);
      service.register(member);
      expect(service.member(container)).toBe(member);
    });
  });

  describe('within-list reorder', () => {
    it('moves a row below a later row (bottom edge) and reports the resulting sibling', async () => {
      const container = buildList(3, 'a'); // a0 a1 a2
      const member = buildMember(container);
      service.register(member);
      await settle();

      const [a0, , a2] = Array.from(container.children) as HTMLElement[];
      await nativeDrag({ from: a0, over: [a2], edge: 'bottom' });

      expect(rowIds(container)).toEqual(['a1', 'a2', 'a0']);
      expect(member.onMoved).toHaveBeenCalledWith(a0, container, container, null);
    });

    it('moves a row above an earlier row (top edge)', async () => {
      const container = buildList(3, 'a');
      const member = buildMember(container);
      service.register(member);
      await settle();

      const [, a1, a2] = Array.from(container.children) as HTMLElement[];
      await nativeDrag({ from: a2, over: [a1], edge: 'top' });

      expect(rowIds(container)).toEqual(['a0', 'a2', 'a1']);
      expect(member.onMoved).toHaveBeenCalledWith(a2, container, container, a1);
    });

    it('keeps order and still reports a move when dropped on itself', async () => {
      const container = buildList(2, 'a');
      const member = buildMember(container);
      service.register(member);
      await settle();

      const [a0, a1] = Array.from(container.children) as HTMLElement[];
      await nativeDrag({ from: a0, over: [a0], edge: 'top' });

      expect(rowIds(container)).toEqual(['a0', 'a1']);
      expect(member.onMoved).toHaveBeenCalledWith(a0, container, container, a1);
    });
  });

  describe('cross-list moves', () => {
    it('runs onAdded on the target then onRemoved on the source', async () => {
      const source = buildList(2, 'a');
      const target = buildList(2, 'b');
      const fromMember = buildMember(source);
      const toMember = buildMember(target);
      service.register(fromMember);
      service.register(toMember);
      await settle();

      const a0 = source.children[0] as HTMLElement;
      const b1 = target.children[1] as HTMLElement;
      await nativeDrag({ from: a0, over: [target, b1], edge: 'bottom' });

      expect(rowIds(target)).toEqual(['b0', 'b1', 'a0']);
      expect(rowIds(source)).toEqual(['a1']);
      expect(toMember.onAdded).toHaveBeenCalledWith(a0, target, source, null);
      expect(fromMember.onRemoved).toHaveBeenCalledWith(a0, target, source, null);
      expect(toMember.onMoved).not.toHaveBeenCalled();
    });

    it('appends when dropped into empty container space', async () => {
      const source = buildList(1, 'a');
      const target = buildList(0, 'b');
      target.style.minHeight = '60px';
      service.register(buildMember(source));
      const toMember = buildMember(target);
      service.register(toMember);
      await settle();

      const a0 = source.children[0] as HTMLElement;
      await nativeDrag({ from: a0, over: [target], edge: 'center' });

      expect(rowIds(target)).toEqual(['a0']);
      expect(toMember.onAdded).toHaveBeenCalledWith(a0, target, source, null);
    });

    it('restores the element at its source index when onAdded resolves false', async () => {
      const source = buildList(3, 'a');
      const target = buildList(1, 'b');
      service.register(buildMember(source));
      const toMember = buildMember(target, { onAdded: vi.fn(() => Promise.resolve(false)) });
      service.register(toMember);
      await settle();

      const a1 = source.children[1] as HTMLElement;
      await nativeDrag({ from: a1, over: [target, target.children[0] as HTMLElement], edge: 'bottom' });
      await settle();

      expect(rowIds(source)).toEqual(['a0', 'a1', 'a2']);
      expect(rowIds(target)).toEqual(['b0']);
    });

    it('restores the element when onAdded rejects', async () => {
      // The service intentionally logs this rejection (console.error('Failed
      // to handle drop...')); silence it here so the run stays pristine.
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const source = buildList(2, 'a');
      const target = buildList(1, 'b');
      service.register(buildMember(source));
      service.register(buildMember(target, { onAdded: vi.fn(() => Promise.reject(new Error('nope'))) }));
      await settle();

      const a0 = source.children[0] as HTMLElement;
      try {
        await nativeDrag({ from: a0, over: [target, target.children[0] as HTMLElement], edge: 'bottom' });
        await settle();

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [message, element, error] = errorSpy.mock.calls[0] as unknown[];
        expect(message).toBe('Failed to handle drop of %O, %O');
        expect(element).toBe(a0);
        expect(error).toBeInstanceOf(Error);

        expect(rowIds(source)).toEqual(['a0', 'a1']);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('does not target a container whose accepts() rejects the element', async () => {
      const source = buildList(1, 'a');
      const target = buildList(1, 'b');
      service.register(buildMember(source));
      const toMember = buildMember(target, { accepts: vi.fn(() => false) });
      service.register(toMember);
      await settle();

      const a0 = source.children[0] as HTMLElement;
      await nativeDrag({ from: a0, over: [target, target.children[0] as HTMLElement], edge: 'bottom', cancel: true });

      expect(rowIds(target)).toEqual(['b0']);
      expect(rowIds(source)).toEqual(['a0']);
      expect(toMember.onAdded).not.toHaveBeenCalled();
    });
  });

  describe('drag gating and lifecycle callbacks', () => {
    it('asks moves() with the element under the pointer as handle', async () => {
      const container = buildList(1, 'a');
      const row = container.children[0] as HTMLElement;
      row.style.position = 'relative';
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      // Absolutely positioned to cover the row's own box, so the dragstart
      // point (row's center) lands on the handle: document.elementFromPoint
      // resolves to whichever element is topmost at that point, and this is
      // what proves moves() receives the handle rather than merely *an*
      // HTMLElement.
      handle.style.cssText = 'position:absolute;inset:0;display:block;';
      row.appendChild(handle);

      const moves = vi.fn((_el:HTMLElement, _c:HTMLElement, h:HTMLElement) => h.classList.contains('drag-handle'));
      const member = buildMember(container, { moves });
      service.register(member);
      await settle();

      await nativeDrag({ from: row, fromElement: handle, over: [row], edge: 'bottom' });
      expect(moves).toHaveBeenCalled();
      expect(moves.mock.calls[0][2]).toBe(handle);
    });

    it('fires onDragStarted once per drag with the original element', async () => {
      const container = buildList(2, 'a');
      const member = buildMember(container, { onDragStarted: vi.fn() });
      service.register(member);
      await settle();

      const a0 = container.children[0] as HTMLElement;
      await nativeDrag({ from: a0, over: [container.children[1] as HTMLElement], edge: 'bottom' });

      expect(member.onDragStarted).toHaveBeenCalledTimes(1);
      expect(member.onDragStarted).toHaveBeenCalledWith(a0);
    });

    it('fires onCancel when the drag ends outside every registered container', async () => {
      const container = buildList(2, 'a');
      const member = buildMember(container, { onCancel: vi.fn() });
      service.register(member);
      await settle();

      const a0 = container.children[0] as HTMLElement;
      await nativeDrag({ from: a0, cancel: true });

      expect(member.onCancel).toHaveBeenCalledWith(a0);
      expect(member.onMoved).not.toHaveBeenCalled();
      expect(rowIds(container)).toEqual(['a0', 'a1']);
    });

    it('renders a custom native preview through onPreviewRendered', async () => {
      const container = buildList(1, 'a');
      const member = buildMember(container, { onPreviewRendered: vi.fn() });
      service.register(member);
      await settle();

      await nativeDrag({ from: container.children[0] as HTMLElement, cancel: true });
      expect(member.onPreviewRendered).toHaveBeenCalled();

      const preview = (member.onPreviewRendered as ReturnType<typeof vi.fn>).mock.calls[0][0] as HTMLElement;
      expect(preview.parentElement?.classList.contains('op-drag-preview')).toBe(true);
    });
  });

  describe('addScrollContainer', () => {
    // This is meant to cover the horizontal-scroll regression fix (boards'
    // `.boards-list--container` needs both axes, unlike the per-member
    // `scrollContainers`, which is vertical-only). Asserting the actual
    // `axis: 'all'` argument reached Pragmatic's
    // `autoScrollForElements` would need intercepting the
    // `core-common/drag-and-drop/auto-scroll` module: `vi.spyOn` fails
    // because the transformed ESM export is non-configurable, and `vi.mock`
    // (even wrapping the real implementation via importOriginal) is not
    // observed by this module's own import of the target — the Angular
    // esbuild-based test builder resolves the `core-common/*` path alias
    // ahead of Vitest's mock interception. Axis coverage therefore stays a
    // manual check (drag a boards column near the edge and confirm the list
    // scrolls); this test only guards against a regression that throws.
    it('registers without throwing for a horizontally scrolling container', () => {
      const element = document.createElement('div');
      element.style.overflowX = 'auto';

      expect(() => service.addScrollContainer(element)).not.toThrow();
    });
  });
});
