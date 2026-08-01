# frozen_string_literal: true

#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require "spec_helper"

RSpec.describe "Wiki BlockNote editor" do
  let(:project) { build_stubbed(:project) }
  let(:wiki) { build_stubbed(:wiki, project:) }
  let(:page) { build_stubbed(:wiki_page, wiki:, title: "Architecture") }
  let(:user) { build_stubbed(:user) }

  before do
    assign(:project, project)
    assign(:wiki, wiki)
    assign(:page, page)
    assign(:content, page)

    without_partial_double_verification do
      allow(view).to receive(:current_user).and_return(user)
    end
  end

  it "renders the BlockNote source mode and actions above the editor" do
    render template: "wiki/new"

    assert_select "form.wiki-editor-form"
    assert_select ".wiki-editor-form--header" do
      assert_select "input[name='page[title]']"
      assert_select "a.button", text: I18n.t(:button_cancel)
      assert_select "button", text: I18n.t(:button_save)
    end
    assert_select ".wiki-editor-form--metadata" do
      assert_select "label[for='page_parent_id']"
      assert_select "label[for='page_journal_notes']", text: I18n.t("attributes.comment")
      assert_select "input[name='page[journal_notes]'].form--text-field"
    end
    assert_select ".wiki-editor-form--content" do
      assert_select "opce-ckeditor-augmented-textarea[data-block-note-source-mode='true']"
    end
    assert_select ".wiki-editor-form--content ~ .wiki-editor-form--actions", count: 0
  end
end
