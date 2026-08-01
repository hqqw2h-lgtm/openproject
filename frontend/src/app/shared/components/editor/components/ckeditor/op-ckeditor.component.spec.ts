import { vi } from 'vitest';
import {
  buildWikiBlockNoteSourceElement,
  findEditorModeSwitchButton,
  isBlockNoteSaveShortcut,
} from './op-ckeditor.component';

describe('Wiki BlockNote source editor', () => {
  it('builds a standalone BlockNote element for the Wiki Markdown mode', () => {
    const onChange = vi.fn();
    const editor = buildWikiBlockNoteSourceElement(
      {
        activeUser: { id: 7, username: 'Ada' },
        attachmentsUploadUrl: '/api/v3/wiki_pages/3/attachments',
        attachmentsCollectionKey: '/api/v3/wiki_pages/3/attachments',
        blocknoteStylesheetUrl: '/assets/blocknote.css',
        shadowDomStylesheetUrl: '/assets/styles.css',
        openProjectUrl: 'http://openproject.localhost:8090/',
      },
      '# Wiki page',
      onChange,
    );

    expect(editor.initialMarkdown).toBe('# Wiki page');
    expect(editor.classList).toContain('wiki-block-note-source');
    expect(editor.getAttribute('standalone-markdown')).toBe('true');
    expect(editor.getAttribute('collaboration-enabled')).toBe('false');
    expect(editor.getAttribute('active-user')).toBe('{"id":7,"username":"Ada"}');
    expect(editor.getAttribute('attachments-upload-url')).toBe('/api/v3/wiki_pages/3/attachments');

    editor.dispatchEvent(new CustomEvent('markdown-change'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('finds the native CKEditor mode switch by its localized label', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="ck-toolbar">
        <button aria-label="Bold"></button>
        <button data-cke-tooltip-text="Switch to WYSIWYG editor "></button>
      </div>
    `;

    const modeSwitch = await findEditorModeSwitchButton(root, 'Switch to WYSIWYG editor');

    expect(modeSwitch?.getAttribute('data-cke-tooltip-text')).toBe('Switch to WYSIWYG editor ');
  });

  it('reveals a mode switch nested in the CKEditor overflow menu', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="ck-toolbar">
        <button aria-haspopup="true" aria-expanded="false">More</button>
      </div>
    `;
    const overflow = root.querySelector<HTMLButtonElement>('button')!;
    overflow.addEventListener('click', () => {
      overflow.setAttribute('aria-expanded', 'true');
      const modeSwitch = document.createElement('button');
      modeSwitch.setAttribute('aria-label', 'Switch to Markdown source');
      root.querySelector('.ck-toolbar')!.append(modeSwitch);
    });

    const modeSwitch = await findEditorModeSwitchButton(root, 'Switch to Markdown source');

    expect(modeSwitch?.getAttribute('aria-label')).toBe('Switch to Markdown source');
    expect(overflow.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the Wiki save shortcuts in BlockNote mode', () => {
    expect(isBlockNoteSaveShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 's' })).toBe(true);
    expect(isBlockNoteSaveShortcut({ ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, key: 'Enter' })).toBe(true);
    expect(isBlockNoteSaveShortcut({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'Enter' })).toBe(false);
    expect(isBlockNoteSaveShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 's' })).toBe(false);
    expect(isBlockNoteSaveShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: true, key: 's' })).toBe(false);
  });
});
