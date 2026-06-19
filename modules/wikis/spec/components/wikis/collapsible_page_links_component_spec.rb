# frozen_string_literal: true

#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2013 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require "spec_helper"
require_module_spec_helper

RSpec.describe Wikis::CollapsiblePageLinksComponent, type: :component do
  let(:provider) { create(:xwiki_provider) }
  let(:heading) { "Inline page links" }

  def page_link_view_model(title)
    Wikis::PageLinkViewModel.from_page_info_result(
      Dry::Monads::Success(
        Wikis::Adapters::Results::PageInfo.new(
          identifier: title,
          title:,
          href: "https://wiki.example.com/#{title}",
          provider:
        )
      )
    )
  end

  subject(:rendered_component) do
    render_inline(described_class.new(page_links, heading:, container: :inline_page_links))
  end

  context "with page links" do
    let(:page_links) { [page_link_view_model("First Page"), page_link_view_model("Second Page")] }

    it_behaves_like "rendering Box", row_count: 2

    it "renders a collapsible header with the heading and item count", :aggregate_failures do
      expect(rendered_component).to have_css("collapsible-header")
      expect(rendered_component).to have_css(".Box-header") do |header|
        expect(header).to have_heading(heading)
        expect(header).to have_css(".Counter", text: "2")
      end
    end

    it "renders a row per page link", :aggregate_failures do
      expect(rendered_component).to have_css(".Box-row", text: "First Page")
      expect(rendered_component).to have_css(".Box-row", text: "Second Page")
    end
  end

  context "without page links" do
    let(:page_links) { [] }

    it "still renders the collapsible header with a hidden zero count", :aggregate_failures do
      expect(rendered_component).to have_css("collapsible-header")
      expect(rendered_component).to have_css(".Box-header") do |header|
        expect(header).to have_heading(heading)
        expect(header).to have_css(".Counter[hidden]", text: "0", visible: :all)
      end
    end
  end
end
