/*
 * -- copyright
 * OpenProject is an open source project management software.
 * Copyright (C) 2023 the OpenProject GmbH
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

import { User } from '@blocknote/core/comments';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { LiveCollaborationManager } from 'core-stimulus/helpers/live-collaboration-helpers';
import { ShadowDomWrapper } from 'op-blocknote-extensions';
import React from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import OpBlockNoteContainer from '../react/OpBlockNoteContainer';
import { OpBlockNoteEditor } from '../react/components/OpBlockNoteEditor';
import * as Y from 'yjs';

export class BlockNoteElement extends HTMLElement {
  private editorRoot:HTMLDivElement;
  private editorMount:HTMLDivElement;
  private reactRoot:Root|null = null;
  private renderCallback:((provider:HocuspocusProvider) => void) | null = null;
  private standaloneDoc:Y.Doc|null = null;
  private standaloneMarkdown = '';
  private standaloneInitialized = false;
  private standaloneMarkdownCompatible = true;

  public initialMarkdown = '';

  constructor() {
    super();

    const shadowRoot = this.attachShadow({ mode: 'open' });

    this.editorRoot = document.createElement('div');
    const browserSpecificClasses = this.getAttribute('browser-specific-classes')?.split(' ').filter(Boolean) ?? [];
    if (browserSpecificClasses.length > 0) {
      this.editorRoot.classList.add(...browserSpecificClasses);
    }

    this.editorMount = document.createElement('div');
    this.editorRoot.appendChild(this.editorMount);
    shadowRoot.appendChild(this.editorRoot);

  }

  connectedCallback() {
    this.ensureStylesheets();

    const collaborationEnabled = this.getAttribute('collaboration-enabled') === 'true';
    const standaloneMarkdownEnabled = this.getAttribute('standalone-markdown') === 'true';

    if (standaloneMarkdownEnabled) {
      this.renderStandaloneMarkdownEditor();
      return;
    }

    if (!collaborationEnabled) return;

    this.reactRoot = createRoot(this.editorMount);

    this.renderCallback = (provider:HocuspocusProvider) => {
      // Do NOT wrap in React.StrictMode. StrictMode's dev-mode double-mount causes
      // BlockNoteView to destroy and recreate the ProseMirror view between the two mounts.
      // y-prosemirror's `yUndoPlugin` destroys the Y.UndoManager on view-destroy (removing
      // its `afterTransaction` handler from the Y.Doc), but the plugin's STATE retains the
      // now-destroyed UndoManager reference. On the second mount the editor reuses the
      // destroyed UndoManager, no `afterTransaction` handler is ever re-attached, no stack
      // items are recorded, and Ctrl+Z becomes a no-op.
      this.reactRoot?.render(this.BlockNoteReactContainer(provider));
    };

    LiveCollaborationManager.onReady(this.renderCallback);
  }

  disconnectedCallback() {
    // Deregister before unmount to prevent stale callbacks firing into a detached element
    if (this.renderCallback) {
      LiveCollaborationManager.offReady(this.renderCallback);
      this.renderCallback = null;
    }

    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }

    this.standaloneDoc?.destroy();
    this.standaloneDoc = null;
    this.standaloneInitialized = false;
    this.standaloneMarkdownCompatible = true;
  }

  public getMarkdownContent():string {
    return this.standaloneInitialized ? this.standaloneMarkdown : this.initialMarkdown;
  }

  private renderStandaloneMarkdownEditor():void {
    const activeUser = this.parseActiveUser();
    if (!activeUser) {
      console.error('Cannot initialize standalone BlockNote editor without an active user.');
      return;
    }

    this.standaloneMarkdown = this.initialMarkdown;
    this.standaloneInitialized = true;
    this.standaloneMarkdownCompatible = true;
    this.standaloneDoc = new Y.Doc();
    this.reactRoot = createRoot(this.editorMount);
    this.reactRoot.render(
      React.createElement(
        ShadowDomWrapper,
        { target: this.editorMount },
        React.createElement(OpBlockNoteEditor, {
          activeUser,
          readOnly: this.getAttribute('read-only') === 'true',
          openProjectUrl: this.getAttribute('open-project-url') ?? '',
          attachmentsUploadUrl: this.getAttribute('attachments-upload-url') ?? '',
          attachmentsCollectionKey: this.getAttribute('attachments-collection-key') ?? '',
          captureExternalLinks: document.body.dataset.externalLinksEnabledValue === 'true',
          doc: this.standaloneDoc,
          initialMarkdown: this.initialMarkdown,
          onMarkdownChange: (markdown:string) => {
            if (!this.standaloneMarkdownCompatible) {
              return;
            }

            this.standaloneMarkdown = markdown;
            this.dispatchEvent(new CustomEvent('markdown-change', {
              bubbles: true,
              composed: true,
              detail: { markdown },
            }));
          },
          onMarkdownCompatibilityError: (lostFragments:string[]) => {
            this.standaloneMarkdownCompatible = false;
            this.standaloneMarkdown = this.initialMarkdown;
            this.dispatchEvent(new CustomEvent('markdown-incompatible', {
              bubbles: true,
              composed: true,
              detail: { lostFragments },
            }));
          },
        })
      )
    );
  }

  private ensureStylesheets():void {
    const stylesheets = [
      ['blocknote-stylesheet-url', 'blocknote'],
      ['shadow-dom-stylesheet-url', 'shadow-dom'],
    ] as const;

    for (const [attribute, key] of stylesheets) {
      const url = this.getAttribute(attribute);
      if (!url || this.shadowRoot?.querySelector(`link[data-op-stylesheet="${key}"]`)) {
        continue;
      }

      const link = document.createElement('link');
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('href', url);
      link.dataset.opStylesheet = key;
      this.shadowRoot?.appendChild(link);
    }
  }

  private BlockNoteReactContainer = (hocuspocusProvider:HocuspocusProvider) => {
    return React.createElement(
      ShadowDomWrapper,
      { target: this.editorMount },
      React.createElement(
        OpBlockNoteContainer,
        {
          activeUser: this.parseActiveUser()!,
          readOnly: this.getAttribute('read-only') === 'true',
          openProjectUrl: this.getAttribute('open-project-url') ?? '',
          attachmentsUploadUrl: this.getAttribute('attachments-upload-url') ?? '',
          attachmentsCollectionKey: this.getAttribute('attachments-collection-key') ?? '',
          captureExternalLinks: document.body.dataset.externalLinksEnabledValue === 'true',
          hocuspocusProvider,
        }
      )
    );
  };

  private parseActiveUser():User | null {
    const userData = this.getAttribute('active-user');
    if (userData) {
      try {
        return JSON.parse(userData) as User;
      } catch (e) {
        console.error('Failed to parse active user data:', e);
        return null;
      }
    }
    return null;
  }
}

if (!customElements.get('op-block-note')) {
  customElements.define('op-block-note', BlockNoteElement);
}
