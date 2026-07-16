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

// Simulates native HTML5 drag interactions against real Pragmatic DnD
// adapters in Vitest browser mode. Pragmatic's element adapter listens for
// native dragstart/dragover/drop/dragend, so dispatching synthetic DragEvents
// with a real DataTransfer drives the full pipeline including hitbox
// closest-edge math (which reads getBoundingClientRect + client coordinates).

function nextFrame():Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
}

// Flush MutationObserver microtasks + one frame, so freshly (un)registered
// rows are picked up before the next interaction.
export async function settle():Promise<void> {
  await Promise.resolve();
  await nextFrame();
}

function pointFor(element:HTMLElement, edge:'top'|'bottom'|'center'):{ clientX:number; clientY:number } {
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  if (edge === 'top') {
    return { clientX, clientY: rect.top + 1 };
  }
  if (edge === 'bottom') {
    return { clientX, clientY: rect.bottom - 1 };
  }
  return { clientX, clientY: rect.top + rect.height / 2 };
}

function fire(
  target:EventTarget,
  type:string,
  dataTransfer:DataTransfer,
  point:{ clientX:number; clientY:number },
):void {
  target.dispatchEvent(new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    ...point,
  }));
}

// Runs a full drag gesture. `over` is visited in order with a dragover each;
// the last entry receives the drop (unless cancel: true, which ends the drag
// outside every target by dropping on document.body).
export async function nativeDrag({
  from,
  fromPoint = 'center',
  fromElement,
  over = [],
  edge = 'center',
  cancel = false,
}:{
  from:HTMLElement;
  fromPoint?:'top'|'bottom'|'center';
  /** Element whose rect the dragstart coordinates are computed from (defaults to `from`) — use this to start the drag over a nested handle. */
  fromElement?:HTMLElement;
  over?:HTMLElement[];
  edge?:'top'|'bottom'|'center';
  cancel?:boolean;
}):Promise<void> {
  const dataTransfer = new DataTransfer();

  fire(from, 'dragstart', dataTransfer, pointFor(fromElement ?? from, fromPoint));
  await settle();

  for (const target of over) {
    const point = pointFor(target, target === over[over.length - 1] ? edge : 'center');
    fire(target, 'dragenter', dataTransfer, point);
    fire(target, 'dragover', dataTransfer, point);
    await settle();
  }

  if (cancel || over.length === 0) {
    const outside = { clientX: 1, clientY: 1 };
    fire(document.body, 'dragover', dataTransfer, outside);
    await settle();
    fire(document.body, 'dragend', dataTransfer, outside);
  } else {
    const target = over[over.length - 1];
    const point = pointFor(target, edge);
    fire(target, 'drop', dataTransfer, point);
    fire(from, 'dragend', dataTransfer, point);
  }

  await settle();
}
