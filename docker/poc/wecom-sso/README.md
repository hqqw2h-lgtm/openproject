# OpenProject 17.8 WeCom OIDC overlay

This overlay runs the modified OpenProject 17.8 source tree with the local
Amperun identity stack. The authentication path is:

```text
WeCom -> Bridge -> Keycloak -> OpenProject native OIDC
```

The image is built from the current checkout with `docker/prod/Dockerfile` and
the `slim-unlocked` target. It also enables Wiki, Documents, BlockNote host
styling, Hocuspocus collaboration, and the local knowledge-base bootstrap.

Use the root authentication Makefile instead of invoking this file alone:

```bash
cp auth/.env.example auth/.env
make -C auth test
make -C auth config
make -C auth up
make -C auth smoke
```

`OPENPROJECT_SOURCE_DIR` defaults to the current fork through `auth/Makefile`.
The OpenProject image, database, cache, seeder, worker, web process and
Hocuspocus service are defined here; Bridge, Keycloak and the public Gateway are
defined in `auth/docker-compose.yml`.

The native provider is seeded from `OPENPROJECT_OPENID__CONNECT_KEYCLOAK_*`
variables. Browser authorization and logout use the public Keycloak issuer;
server-side token, userinfo and JWKS requests use the private
`openproject-idp-backplane` network.

Local endpoints:

- `http://openproject.localhost:8090/`
- `http://keycloak.localhost:8090/admin`
- `http://bridge.localhost:8090/.well-known/openid-configuration`

`make -C auth down` preserves volumes. `make -C auth destroy` removes the local
project and all its volumes. Public URLs, callbacks and Client secrets are
reconciled by `make -C auth up`; incompatible Realm structure changes require
the all-volume `make -C auth reset`. A Keycloak-only reset is intentionally not
provided because it changes downstream user subjects.

This is an HTTP development environment with local default passwords. Before
production use, replace every Secret, terminate HTTPS on controlled domains,
use managed databases and backups, restrict administrator access, and implement
employee lifecycle deprovisioning.

See `auth/docs/wecom-admin-setup.md` for enterprise administrator steps and
`UPGRADE-17.6-TO-17.8.md` for the isolated migration procedure.
