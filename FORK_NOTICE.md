# Fork notice (GPLv3 §5)

This repository is a modified version of [OpenProject](https://github.com/opf/openproject).

## License

OpenProject, including Enterprise add-ons, is licensed under the
**GNU General Public License version 3** (`LICENSE`, `COPYRIGHT`).
The `openproject-token` gem used for Enterprise plan/feature metadata is also
licensed as **GPL-3.0**.

Official FAQ confirmation:
[Are also the Enterprise add-ons open source?](https://www.openproject.org/docs/enterprise-guide/enterprise-on-premises-guide/enterprise-on-premises-faq/)
→ Yes, Enterprise add-ons are developed under GPLv3.

## Modification notice

**Date:** 2026-07-20
**Integration update:** 2026-07-29
**Fork:** `hqqw2h-lgtm/openproject`

This fork modifies Enterprise feature gating so that:

1. The `slim-unlocked` image enables all Enterprise add-on feature checks
   without a paid Enterprise token.
2. Enterprise upsell / trial banners are hidden in that image.
3. A source checkout keeps the standard token-backed behavior unless
   `enterprise_features_unlocked` is explicitly enabled.

Changed files:

- `app/models/enterprise_token.rb`
- `config/constants/settings/definition.rb`
- `docker/prod/Dockerfile`
- `modules/documents/app/assets/stylesheets/_index.sass`
- `docker/poc/wecom-sso/`
- `auth/`
- `codegraph/`

The original copyright notices and GPLv3 license texts are preserved.
This modified work is released under the same GPLv3 terms.

## Distribution obligations

If you convey this modified version (source or binaries) to others, you must:

- Keep the GPLv3 license and copyright notices intact.
- Provide Corresponding Source under GPLv3.
- Preserve this modification notice (or equivalent prominent notices with date).

## Non-claims

This fork is **not** an official OpenProject GmbH Enterprise product and does
**not** include OpenProject commercial support entitlements. Trademarks of
OpenProject GmbH remain their property.
