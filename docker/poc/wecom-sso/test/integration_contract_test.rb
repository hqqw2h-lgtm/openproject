# frozen_string_literal: true

require "minitest/autorun"
require "json"
require "pathname"

class WeComSsoIntegrationContractTest < Minitest::Test
  ROOT = Pathname(__dir__).join("../../../..").expand_path

  def source(path)
    ROOT.join(path).read
  end

  def test_unlocked_image_is_built_from_the_same_source_tree
    dockerfile = source("docker/prod/Dockerfile")
    compose = source("docker/poc/wecom-sso/docker-compose.yml")

    assert_match(/^FROM slim AS slim-unlocked$/, dockerfile)
    assert_match(/OPENPROJECT_ENTERPRISE__FEATURES__UNLOCKED=true/, dockerfile)
    assert_match(%r{dockerfile: docker/prod/Dockerfile}, compose)
    assert_match(/target: slim-unlocked/, compose)
    assert_match(/OPENPROJECT_ENTERPRISE__FEATURES__UNLOCKED: "true"/, compose)
    refute_match(/OPENPROJECT_NATIVE__SSO__PROVIDERS__DISABLED/, compose)
    refute_match(/Dockerfile\.openproject|install-block-note-host-patch/, compose)
  end

  def test_enterprise_unlock_is_explicit_and_token_behavior_remains_available
    model = source("app/models/enterprise_token.rb")
    settings = source("config/constants/settings/definition.rb")

    assert_match(/return true if enterprise_features_unlocked\?/, model)
    assert_match(/active_tokens\.any\?/, model)
    assert_match(/enterprise_features_unlocked:/, settings)
    refute_match(/native_sso_providers_disabled:/, settings)
    assert_match(/default: false/, settings)
  end

  def test_block_note_caret_fix_is_part_of_the_source_styles
    styles = source("modules/documents/app/assets/stylesheets/_index.sass")

    assert_match(/^op-block-note\n  display: block\n  width: 100%$/m, styles)
  end

  def test_knowledge_base_bootstrap_keeps_the_existing_poc_scope
    bootstrap = source("docker/poc/wecom-sso/configure-community-knowledge-base.rb")

    %w[view_wiki_pages edit_wiki_pages view_documents manage_documents].each do |permission|
      assert_includes bootstrap, permission
    end
    assert_includes bootstrap, "Role::BUILTIN_NON_MEMBER"
    assert_includes bootstrap, "Project.active.where(public: true)"
    refute_includes bootstrap, "BUILTIN_ANONYMOUS"
  end

  def test_native_oidc_is_seeded_for_the_wecom_keycloak_broker
    compose = source("docker/poc/wecom-sso/docker-compose.yml")
    auth_compose = source("auth/docker-compose.yml")
    realm = JSON.parse(source("auth/keycloak/amperun-realm.json"))
    openproject_client = realm.fetch("clients").find { |client| client["clientId"] == "openproject" }

    assert_match(/OPENPROJECT_OPENID__CONNECT_KEYCLOAK_DISPLAY__NAME: 企业微信/, compose)
    assert_match(/OPENPROJECT_OPENID__CONNECT_KEYCLOAK_IDENTIFIER: openproject/, compose)
    assert_match(/OPENPROJECT_OPENID__CONNECT_KEYCLOAK_SECRET:/, compose)
    refute_match(/OPENPROJECT_NATIVE__SSO__PROVIDERS__DISABLED/, compose)
    refute_match(/OPENPROJECT_AUTH__SOURCE__SSO_HEADER|OPENPROJECT_SEED__LDAP/, compose)
    refute_match(/openproject-auth:|openproject-header-gateway:|directory:/, auth_compose)
    refute_nil openproject_client
    assert_includes openproject_client.fetch("redirectUris"),
                    "http://openproject.localhost:8090/auth/keycloak/callback"
  end

  def test_upgrade_waits_for_the_restore_database_to_be_healthy
    upgrade_guide = source("docker/poc/wecom-sso/UPGRADE-17.6-TO-17.8.md")

    assert_match(
      /for volume in openproject-db .*docker volume inspect "amperun-sso-fork_\$\{volume\}"/m,
      upgrade_guide
    )
    assert_match(/up -d --wait op-db/, upgrade_guide)
    assert_match(/pg_restore .*--exit-on-error --single-transaction/m, upgrade_guide)
  end
end
