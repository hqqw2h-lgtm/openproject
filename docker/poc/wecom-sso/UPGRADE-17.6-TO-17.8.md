# OpenProject 17.6 to 17.8 isolated migration

Do not migrate the existing 17.6 volumes in place. Keep separate Compose
projects so rollback can start the untouched old stack:

- old project: `amperun-sso`, source `/Users/abner/amperun/openproject`;
- new project: `amperun-sso-fork`, source `/Users/abner/amperun/openproject-hqqw-main`;
- only one project may bind local port `8090` at a time.

The new stack uses OpenProject native OIDC and a new Keycloak Client. Preserve
the old identity volumes for rollback, but do not restore the old Keycloak or
directory data into the new project. A Realm import does not overwrite an
existing Realm, so restoring the old Keycloak volume would retain the obsolete
Client and prevent deterministic startup.

## 1. Back up the old stack

Set paths and create a protected backup directory:

```bash
export FORK_DIR=/Users/abner/amperun/openproject-hqqw-main
export LEGACY_DIR=/Users/abner/amperun/openproject
export LEGACY_AUTH_DIR=/Users/abner/amperun/auth
export LEGACY_ENV_FILE=$LEGACY_AUTH_DIR/.env
export FORK_ENV_FILE=$FORK_DIR/auth/.env
export BACKUP_DIR=$HOME/openproject-backups/openproject-17.6-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$BACKUP_DIR"
```

During a maintenance window, export the database and archive state needed for
rollback. Keep Secret files outside Git:

```bash
install -m 600 "$LEGACY_ENV_FILE" "$BACKUP_DIR/legacy.env"

docker exec amperun-sso-op-db-1 \
  pg_dump -U openproject -d openproject -Fc \
  > "$BACKUP_DIR/openproject.dump"

docker exec -i amperun-sso-op-db-1 \
  pg_restore --list \
  < "$BACKUP_DIR/openproject.dump" \
  > "$BACKUP_DIR/database-contents.txt"

for volume in openproject-assets bridge-data directory-config directory-data keycloak-db; do
  docker run --rm \
    -v "amperun-sso_${volume}:/source:ro" \
    -v "$BACKUP_DIR:/backup" \
    postgres:17-alpine \
    tar -C /source -czf "/backup/${volume}.tgz" .
  tar -tzf "$BACKUP_DIR/${volume}.tgz" > "$BACKUP_DIR/${volume}-contents.txt"
done
```

Stop without deleting the old project:

```bash
make -C "$LEGACY_AUTH_DIR" PROJECT_NAME=amperun-sso \
  OPENPROJECT_DIR="$LEGACY_DIR" ENV_FILE="$LEGACY_ENV_FILE" down
```

## 2. Prepare the new environment

Create `auth/.env` from the new template. Copy only the OpenProject database,
application and collaboration secrets that must remain stable. Remove obsolete
keys and generate the new native OIDC Client Secret:

```bash
cp "$FORK_DIR/auth/.env.example" "$FORK_ENV_FILE"
chmod 600 "$FORK_ENV_FILE"
```

Required new identity values include:

```dotenv
KEYCLOAK_BROKER_CLIENT_SECRET=<new-random-value>
OPENPROJECT_OIDC_CLIENT_SECRET=<new-random-value>
BRIDGE_COOKIE_KEYS=<new-random-value>
```

Copy the real WeCom settings and `WECOM_ALLOWED_USER_IDS` through a protected
channel. Do not restore `amperun-sso_keycloak-db`, `directory-config`, or
`directory-data` into the new project.

## 3. Restore OpenProject and stable Bridge identity data

Refuse to reuse target volumes from an earlier attempt:

```bash
for volume in openproject-db openproject-assets bridge-data keycloak-db; do
  if docker volume inspect "amperun-sso-fork_${volume}" >/dev/null 2>&1; then
    echo "Target volume already exists: amperun-sso-fork_${volume}" >&2
    exit 1
  fi
done
```

Restore attachments and the Bridge identity registry. The registry preserves
stable WeCom person subjects:

```bash
for volume in openproject-assets bridge-data; do
  docker volume create "amperun-sso-fork_${volume}"
  docker run --rm \
    -v "amperun-sso-fork_${volume}:/target" \
    -v "$BACKUP_DIR:/backup:ro" \
    postgres:17-alpine \
    tar -C /target -xzf "/backup/${volume}.tgz"
done
```

Render the new configuration, start only PostgreSQL, and restore the database:

```bash
cd "$FORK_DIR"
make -C auth ENV_FILE="$FORK_ENV_FILE" OPENPROJECT_DIR="$FORK_DIR" config

env OPENPROJECT_SOURCE_DIR="$FORK_DIR" docker-compose \
  --env-file "$FORK_ENV_FILE" -p amperun-sso-fork \
  -f auth/docker-compose.yml \
  -f docker/poc/wecom-sso/docker-compose.yml \
  up -d --wait op-db

docker exec -i amperun-sso-fork-op-db-1 \
  pg_restore -U openproject -d openproject --clean --if-exists \
  --exit-on-error --single-transaction \
  < "$BACKUP_DIR/openproject.dump"
```

## 4. Start and validate 17.8

```bash
make -C auth PROJECT_NAME=amperun-sso-fork \
  OPENPROJECT_DIR="$FORK_DIR" ENV_FILE="$FORK_ENV_FILE" up
make -C auth PROJECT_NAME=amperun-sso-fork \
  OPENPROJECT_DIR="$FORK_DIR" ENV_FILE="$FORK_ENV_FILE" smoke
```

Validate with a copied database before production cutover:

- OpenProject reports `17.8.0` and health checks pass;
- Wiki history, Documents, projects, work packages and attachments are present;
- the login page shows the native “企业微信” provider;
- one existing test employee logs into the intended historical user, not a new duplicate;
- a second login reuses the same OIDC identity;
- a user outside `WECOM_ALLOWED_USER_IDS` is rejected;
- BlockNote cursor placement and two-client Hocuspocus editing work;
- Keycloak contains Client `openproject` with callback `/auth/keycloak/callback`;
- the removed identity services are absent from the rendered Compose project.

Identity association is the highest-risk migration step. If the first existing
employee would create a duplicate OpenProject account, stop the test and define
an explicit account-linking migration; do not merge accounts only because email
addresses match.

## 5. Roll back

Stop only the new project and restart the untouched old project:

```bash
make -C "$FORK_DIR/auth" PROJECT_NAME=amperun-sso-fork \
  OPENPROJECT_DIR="$FORK_DIR" ENV_FILE="$FORK_ENV_FILE" down
make -C "$LEGACY_AUTH_DIR" PROJECT_NAME=amperun-sso \
  OPENPROJECT_DIR="$LEGACY_DIR" ENV_FILE="$LEGACY_ENV_FILE" up
```

Never point 17.6 at the migrated 17.8 database. Retain the backup and old
volumes until production acceptance and the rollback window are both closed.
