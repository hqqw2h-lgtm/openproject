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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PathHelperService } from 'core-app/core/path-helper/path-helper.service';
import { HalResourceService } from 'core-app/features/hal/services/hal-resource.service';
import { ToastService } from 'core-app/shared/components/toaster/toast.service';
import { I18nService } from 'core-app/core/i18n/i18n.service';
import { States } from 'core-app/core/states/states.service';
import { CkeditorAugmentedTextareaComponent } from './ckeditor-augmented-textarea.component';

describe('CkeditorAugmentedTextareaComponent', () => {
  let fixture:ComponentFixture<CkeditorAugmentedTextareaComponent>;
  let component:CkeditorAugmentedTextareaComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CkeditorAugmentedTextareaComponent],
      providers: [
        { provide: PathHelperService, useValue: {} },
        { provide: HalResourceService, useValue: {} },
        { provide: ToastService, useValue: {} },
        { provide: I18nService, useValue: { t: (key:string) => key } },
        { provide: States, useValue: {} },
      ],
    })
      // Skip the real template (op-ckeditor and friends) — this skeleton only
      // exercises the refresh listener, not the editor itself.
      .overrideComponent(CkeditorAugmentedTextareaComponent, { set: { template: '' } })
      .compileComponents();

    // No detectChanges() → ngOnInit does not run, so no CKEditor instance is created.
    fixture = TestBed.createComponent(CkeditorAugmentedTextareaComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => vi.restoreAllMocks());

  it('flushes to the textarea when a refresh beforeSnapshot event fires', () => {
    const form = document.createElement('form');
    component.formElement = form;
    const sync = vi.spyOn(component, 'syncToTextarea').mockImplementation(() => undefined);

    (component as unknown as { registerRefreshSyncListener():void }).registerRefreshSyncListener();
    form.dispatchEvent(new Event('refresh-on-form-changes:beforeSnapshot'));

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('passes the standalone BlockNote source configuration to CKEditor', () => {
    const form = document.createElement('form');
    const textarea = document.createElement('textarea');
    textarea.id = 'wiki-page-text';
    form.append(textarea, fixture.nativeElement as HTMLElement);
    document.body.append(form);

    component.textAreaId = textarea.id;
    component.blockNoteSourceMode = true;
    component.blockNoteActiveUser = { id: 7, username: 'Ada' };
    component.blockNoteAttachmentsUploadUrl = '/api/v3/wiki_pages/3/attachments';
    component.blockNoteAttachmentsCollectionKey = '/api/v3/wiki_pages/3/attachments';
    component.blockNoteStylesheetUrl = '/assets/blocknote.css';
    component.blockNoteShadowDomStylesheetUrl = '/assets/styles.css';
    component.openProjectUrl = 'http://openproject.localhost:8090/';

    component.ngOnInit();

    expect(component.context.blockNoteSourceMode).toEqual({
      activeUser: { id: 7, username: 'Ada' },
      attachmentsUploadUrl: '/api/v3/wiki_pages/3/attachments',
      attachmentsCollectionKey: '/api/v3/wiki_pages/3/attachments',
      blocknoteStylesheetUrl: '/assets/blocknote.css',
      shadowDomStylesheetUrl: '/assets/styles.css',
      openProjectUrl: 'http://openproject.localhost:8090/',
    });

    form.remove();
  });

  it('keeps the external mode switch in sync with CKEditor', () => {
    const toggleManualMode = vi.fn();
    (component as unknown as { ckEditorInstance:{ toggleManualMode:() => void } }).ckEditorInstance = { toggleManualMode };

    component.sourceModeChanged(true);
    component.toggleEditorMode();

    expect(component.sourceModeActive).toBe(true);
    expect(toggleManualMode).toHaveBeenCalledTimes(1);
  });
});
