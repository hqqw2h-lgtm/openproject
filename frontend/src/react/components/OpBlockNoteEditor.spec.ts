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

import {
  blockNoteSchema,
  extractTableOfContents,
  supportedCodeBlockLanguages,
} from './OpBlockNoteEditor';

describe('OpBlockNoteEditor configuration', () => {
  it('renders a language selector for code blocks', () => {
    expect(blockNoteSchema.blockSpecs.codeBlock.config.propSchema.language.default).toBe('text');
    expect(blockNoteSchema.blockSpecs.codeBlock.config.type).toBe('codeBlock');
    expect(Object.keys(supportedCodeBlockLanguages)).toEqual([
      'text',
      'bash',
      'css',
      'html',
      'javascript',
      'json',
      'kotlin',
      'markdown',
      'python',
      'ruby',
      'sql',
      'typescript',
      'yaml',
    ]);
    expect(supportedCodeBlockLanguages.javascript).toEqual({
      name: 'JavaScript',
      aliases: ['js', 'jsx'],
    });
  });

  it('extracts only non-empty H1 to H3 headings in document order', () => {
    expect(extractTableOfContents([
      {
        id: 'heading-1',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Overview', styles: {} }],
        children: [],
      },
      {
        id: 'paragraph-1',
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'Body', styles: {} }],
        children: [],
      },
      {
        id: 'heading-2',
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'Details', styles: {} }],
        children: [],
      },
      {
        id: 'heading-empty',
        type: 'heading',
        props: { level: 2 },
        content: [],
        children: [],
      },
    ] as never)).toEqual([
      { id: 'heading-1', level: 1, title: 'Overview' },
      { id: 'heading-2', level: 3, title: 'Details' },
    ]);
  });

});
