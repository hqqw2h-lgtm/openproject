/*
 * -- copyright
 * OpenProject is an open source project management software.
 * Copyright (C) the OpenProject GmbH
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License version 3.
 *
 * OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
 * Copyright (C) 2006-2013 Jean-Philippe Lang
 * Copyright (C) 2010-2013 the ChiliProject Team
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 *
 * See COPYRIGHT and LICENSE files for more details.
 * ++
 */

import {
  BlockNoteEditorOptions,
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
} from '@blocknote/core';
import { ExternalLinkA11yExtension } from '../extensions/external-link-a11y';
import { ExternalLinkCaptureExtension } from '../extensions/external-link-capture';
import { User } from '@blocknote/core/comments';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  initializeOpBlockNoteExtensions,
  openProjectWorkPackageBlockSpec,
  openProjectWorkPackageInlineSpec,
  workPackageSlashMenu,
  useHashWpMenu,
} from 'op-blocknote-extensions';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { useBlockNoteAttachments } from '../hooks/useBlockNoteAttachments';
import { useBlockNoteLocale } from '../hooks/useBlockNoteLocale';
import { useOpTheme } from '../hooks/useOpTheme';

interface CollaborativeUser {
  name:string;
  color:string;
}

export interface OpBlockNoteEditorProps {
  activeUser:User;
  readOnly:boolean;
  openProjectUrl:string;
  attachmentsUploadUrl:string;
  attachmentsCollectionKey:string;
  captureExternalLinks:boolean;
  hocuspocusProvider?:HocuspocusProvider;
  doc:Y.Doc;
  initialMarkdown?:string;
  onMarkdownChange?:(markdown:string) => void;
  onMarkdownCompatibilityError?:(lostFragments:string[]) => void;
}

export const supportedCodeBlockLanguages = {
  text: { name: 'Plain text', aliases: ['txt'] },
  bash: { name: 'Bash', aliases: ['sh', 'shell'] },
  css: { name: 'CSS' },
  html: { name: 'HTML' },
  javascript: { name: 'JavaScript', aliases: ['js', 'jsx'] },
  json: { name: 'JSON' },
  kotlin: { name: 'Kotlin', aliases: ['kt'] },
  markdown: { name: 'Markdown', aliases: ['md'] },
  python: { name: 'Python', aliases: ['py'] },
  ruby: { name: 'Ruby', aliases: ['rb'] },
  sql: { name: 'SQL' },
  typescript: { name: 'TypeScript', aliases: ['ts', 'tsx'] },
  yaml: { name: 'YAML', aliases: ['yml'] },
};

const schema = BlockNoteSchema.create().extend({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec({
      defaultLanguage: 'text',
      supportedLanguages: supportedCodeBlockLanguages,
    }),
    openProjectWorkPackageBlock: openProjectWorkPackageBlockSpec(),
  },
  inlineContentSpecs: {
    openProjectWorkPackageInline: openProjectWorkPackageInlineSpec,
  },
});

export const blockNoteSchema = schema;

const protectedMarkdownPatterns = [
  /<!--[\s\S]*?-->/g,
  /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>\n]*?)?\/?>/g,
  /\{\{[^}\n]+\}\}/g,
  /\[\[[^\]\n]+\]\]/g,
];

function extractProtectedMarkdownFragments(markdown:string):string[] {
  return protectedMarkdownPatterns.flatMap((pattern) => markdown.match(pattern) ?? []);
}

export function findLostProtectedMarkdownFragments(original:string, serialized:string):string[] {
  const serializedCounts = new Map<string, number>();
  for (const fragment of extractProtectedMarkdownFragments(serialized)) {
    serializedCounts.set(fragment, (serializedCounts.get(fragment) ?? 0) + 1);
  }

  return extractProtectedMarkdownFragments(original).filter((fragment) => {
    const remaining = serializedCounts.get(fragment) ?? 0;
    if (remaining === 0) {
      return true;
    }

    serializedCounts.set(fragment, remaining - 1);
    return false;
  });
}

export interface TableOfContentsEntry {
  id:string;
  level:number;
  title:string;
}

interface TableOfContentsBlock {
  id:string;
  type:string;
  props:Record<string, unknown>;
  content:unknown;
  children?:TableOfContentsBlock[];
}

function inlineContentToText(content:unknown):string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content.map((item:unknown) => {
    if (!item || typeof item !== 'object') {
      return '';
    }

    if ('text' in item && typeof item.text === 'string') {
      return item.text;
    }

    if ('content' in item) {
      return inlineContentToText(item.content);
    }

    return '';
  }).join('').trim();
}

export function extractTableOfContents(blocks:readonly TableOfContentsBlock[]):TableOfContentsEntry[] {
  return blocks.flatMap((block) => {
    const level = Number(block.props.level);
    const title = block.type === 'heading' ? inlineContentToText(block.content) : '';
    const current = block.type === 'heading' && level >= 1 && level <= 3 && title
      ? [{ id: block.id, level, title }]
      : [];

    return [...current, ...extractTableOfContents(block.children ?? [])];
  });
}

function generateRandomColor() {
  return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}

export function OpBlockNoteEditor({
  activeUser,
  readOnly,
  openProjectUrl,
  attachmentsUploadUrl,
  attachmentsCollectionKey,
  captureExternalLinks,
  hocuspocusProvider,
  doc,
  initialMarkdown,
  onMarkdownChange,
  onMarkdownCompatibilityError,
}:OpBlockNoteEditorProps) {
  const { localeString, localeDictionary } = useBlockNoteLocale(window.I18n.locale);
  const { enabled: attachmentsEnabled, uploadFile } = useBlockNoteAttachments(attachmentsCollectionKey, attachmentsUploadUrl);

  useEffect(() => {
    initializeOpBlockNoteExtensions({ baseUrl: openProjectUrl, locale: localeString });
  }, [openProjectUrl, localeString]);

  const editorParams = useMemo<Partial<BlockNoteEditorOptions<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>>>(() => {
    return {
      schema,
      // BlockNote 0.51 tightened `collaboration.provider` to a non-null shape
      // and `awareness: Awareness | undefined` (vs Hocuspocus's
      // `Awareness | null`). Omit the whole `collaboration` block when no
      // provider is wired up; cast the provider at the boundary otherwise.
      ...(hocuspocusProvider && {
        collaboration: {
          fragment: doc.getXmlFragment('document-store'),
          user: {
            name: activeUser.username,
            color: generateRandomColor(),
            id: activeUser.id,
          } as unknown as CollaborativeUser,
          provider: hocuspocusProvider as unknown as { awareness?:NonNullable<HocuspocusProvider['awareness']> },
          showCursorLabels: 'activity' as const,
        },
      }),
      dictionary: localeDictionary,
      ...(attachmentsEnabled && { uploadFile }),
      extensions: [
        ExternalLinkA11yExtension,
        ...(captureExternalLinks ? [ExternalLinkCaptureExtension] : []),
      ],
    };
  }, [hocuspocusProvider, doc, activeUser, localeDictionary, attachmentsEnabled, uploadFile, captureExternalLinks]);

  // Create the editor exactly once per mount. `useCreateBlockNote(options, deps)` uses `deps`
  // as the sole `useMemo` key — `options` is intentionally NOT in deps. `[activeUser]` rebuilt
  // the editor (wiping `Y.UndoManager` history) whenever a fresh `activeUser` reference
  // reached this component, e.g. on Stimulus reconnect / Turbo morph.
  const editor = useCreateBlockNote(editorParams, []);
  type EditorType = typeof editor;
  const theme = useOpTheme();
  const initialMarkdownLoaded = useRef(false);

  useEffect(() => {
    if (initialMarkdownLoaded.current || initialMarkdown === undefined) {
      return;
    }

    initialMarkdownLoaded.current = true;
    const blocks = editor.tryParseMarkdownToBlocks(initialMarkdown);
    editor.replaceBlocks(editor.document, blocks);
    const lostFragments = findLostProtectedMarkdownFragments(initialMarkdown, editor.blocksToMarkdownLossy());
    if (lostFragments.length > 0) {
      onMarkdownCompatibilityError?.(lostFragments);
    }
  }, [editor, initialMarkdown, onMarkdownCompatibilityError]);

  useEffect(() => {
    if (!onMarkdownChange) {
      return undefined;
    }

    return editor.onChange(() => onMarkdownChange(editor.blocksToMarkdownLossy()));
  }, [editor, onMarkdownChange]);

  const getCustomSlashMenuItems = useCallback((editorInstance:EditorType) => [
    ...getDefaultReactSlashMenuItems(editorInstance),
    workPackageSlashMenu(editorInstance),
  ], []);
  const { getHashItems, HashWpMenu } = useHashWpMenu(editor);

  useEffect(() => {
    const publishTableOfContents = () => {
      window.dispatchEvent(new CustomEvent<TableOfContentsEntry[]>('documents:table-of-contents-updated', {
        detail: extractTableOfContents(editor.document),
      }));
    };

    publishTableOfContents();
    return editor.onChange(publishTableOfContents);
  }, [editor]);

  useEffect(() => {
    const navigateToHeading = (event:Event) => {
      const { id } = (event as CustomEvent<{ id:string }>).detail;
      const heading = editor.domElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.addEventListener('documents:table-of-contents-navigate', navigateToHeading);
    return () => window.removeEventListener('documents:table-of-contents-navigate', navigateToHeading);
  }, [editor]);

  return (
    <>
      <BlockNoteView
        editor={editor}
        slashMenu={false}
        theme={theme}
        editable={!readOnly}
        className={'block-note-editor-container'}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query:string) => Promise.resolve(filterSuggestionItems(getCustomSlashMenuItems(editor), query))}
        />
        <SuggestionMenuController
          triggerCharacter="#"
          getItems={getHashItems}
          suggestionMenuComponent={HashWpMenu}
        />
      </BlockNoteView>
    </>
  );
}
