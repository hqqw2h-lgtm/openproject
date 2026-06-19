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
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require "rails_helper"

RSpec.describe WorkPackageTypes::ExportTemplateRowComponent, type: :component do
  include Rails.application.routes.url_helpers

  let(:type) { create(:type) }
  let(:template) { type.pdf_export_templates.list.first }

  subject(:rendered_component) { render_inline(described_class.new(type:, template:)) }

  it "renders a unique wrapper derived from the template id" do
    expect(rendered_component)
      .to have_css("#work-package-types-export-template-row-component-#{template.id}", count: 1)
  end

  it "renders the template label and caption" do
    expect(rendered_component).to have_text(template.label)
    expect(rendered_component).to have_text(template.caption)
  end

  it "labels the toggle button with its template and reflects the enabled state" do
    expect(rendered_component).to have_button(
      accessible_name: I18n.t(
        "types.edit.export_configuration.pdf_export_templates.actions.label_toggle_template",
        template: template.label
      ),
      aria: { pressed: template.enabled }
    )
  end
end
