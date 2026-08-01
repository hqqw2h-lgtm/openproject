/*
 * -- copyright
 * OpenProject is an open source project management software.
 * Copyright (C) the OpenProject GmbH
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License version 3.
 *
 * See COPYRIGHT and LICENSE files for more details.
 * ++
 */

import { Controller } from '@hotwired/stimulus';

interface TableOfContentsEntry {
  id:string;
  level:number;
  title:string;
}

export default class TableOfContentsController extends Controller {
  static targets = ['empty', 'list'];

  declare readonly emptyTarget:HTMLElement;
  declare readonly listTarget:HTMLOListElement;

  update(event:CustomEvent<TableOfContentsEntry[]>):void {
    this.listTarget.replaceChildren(...event.detail.map((heading) => this.buildItem(heading)));
    this.emptyTarget.hidden = event.detail.length > 0;
    this.listTarget.hidden = event.detail.length === 0;
  }

  navigate(event:Event):void {
    const id = (event.currentTarget as HTMLButtonElement).dataset.headingId;
    if (id) {
      window.dispatchEvent(new CustomEvent('documents:table-of-contents-navigate', { detail: { id } }));
    }
  }

  private buildItem(heading:TableOfContentsEntry):HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = heading.title;
    button.dataset.headingId = heading.id;
    button.dataset.headingLevel = String(heading.level);
    button.className = 'document-table-of-contents--link';
    button.addEventListener('click', (event) => this.navigate(event));
    item.appendChild(button);

    return item;
  }
}