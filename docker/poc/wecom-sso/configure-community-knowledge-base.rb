# frozen_string_literal: true

# This PoC treats public projects as an employee-wide knowledge base. The
# application gateway still requires an authenticated enterprise identity;
# private projects continue to require explicit OpenProject membership.
unless ENV.fetch("OPENPROJECT_POC_PUBLIC_KNOWLEDGE_BASE", "false") == "true"
  puts "Community knowledge-base bootstrap is disabled"
  exit
end

knowledge_permissions = %i[
  view_wiki_pages
  view_wiki_edits
  edit_wiki_pages
  view_documents
  manage_documents
]

non_member_role = Role.find_by!(builtin: Role::BUILTIN_NON_MEMBER)
missing_permissions = knowledge_permissions - non_member_role.permissions
non_member_role.add_permission!(*missing_permissions) if missing_permissions.any?

default_modules = Array(Setting.default_projects_modules).map(&:to_s)
Setting.default_projects_modules = default_modules | %w[wiki documents]

collaboration_ready = Setting.collaborative_editing_hocuspocus_url.present? &&
  Setting.collaborative_editing_hocuspocus_secret.present?
unless Setting.real_time_text_collaboration_enabled? && collaboration_ready
  raise "Real-time collaboration must be enabled with a Hocuspocus URL and secret"
end

configured_projects = 0
Project.active.where(public: true).find_each do |project|
  %w[wiki documents].each do |module_name|
    project.enabled_modules.find_or_create_by!(name: module_name)
  end

  project.create_wiki!(start_page: "Wiki") unless project.wiki
  configured_projects += 1
end

puts "Community knowledge base configured: " \
     "role=#{non_member_role.name.inspect} " \
     "permissions_added=#{missing_permissions.sort.join(',')} " \
     "public_projects=#{configured_projects} " \
     "collaboration_enabled=#{collaboration_ready}"
