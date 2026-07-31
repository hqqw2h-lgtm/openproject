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

import { fireEvent } from '@testing-library/dom';
import { setupStimulusTest, type StimulusTestContext } from 'core-stimulus/test-helpers';
import TableOfContentsController from './table-of-contents.controller';

describe('TableOfContentsController', () => {
  let ctx:StimulusTestContext;

  beforeEach(async () => {
    ctx = await setupStimulusTest({
      controllers: { 'documents--table-of-contents': TableOfContentsController },
    });

    await ctx.mount(`
      <nav
        data-controller="documents--table-of-contents"
        data-action="documents:table-of-contents-updated@window->documents--table-of-contents#update"
      >
        <p data-documents--table-of-contents-target="empty">No headings</p>
        <ol data-documents--table-of-contents-target="list"></ol>
      </nav>
    `);
  });

  afterEach(() => ctx.dispose());

  it('renders headings and dispatches navigation requests', () => {
    window.dispatchEvent(new CustomEvent('documents:table-of-contents-updated', {
      detail: [
        { id: 'overview', level: 1, title: 'Overview' },
        { id: 'details', level: 3, title: 'Details' },
      ],
    }));

    const buttons = ctx.screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Overview', 'Details']);
    expect(buttons[1]).toHaveAttribute('data-heading-level', '3');

    const listener = vi.fn();
    window.addEventListener('documents:table-of-contents-navigate', listener, { once: true });
    fireEvent.click(buttons[1]);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { id: 'details' } }));
  });
});