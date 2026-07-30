import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(bridgeRoot, '..', '..');
const openProjectRoot = path.resolve(
  process.env.OPENPROJECT_SOURCE_DIR || workspaceRoot,
);
const execFileAsync = promisify(execFile);

function dockerComposeArgs(args) {
  const [command, ...prefixArgs] = (process.env.DOCKER_COMPOSE_COMMAND || 'docker-compose')
    .trim()
    .split(/\s+/);
  return { command, args: [...prefixArgs, ...args] };
}

test('auth compose exposes stable browser-and-container hostnames', async () => {
  const compose = await readFile(path.join(workspaceRoot, 'auth', 'docker-compose.yml'), 'utf8');
  const caddyfile = await readFile(path.join(workspaceRoot, 'auth', 'proxy', 'Caddyfile'), 'utf8');

  for (const hostname of ['bridge.localhost', 'keycloak.localhost', 'openproject.localhost']) {
    assert.match(compose, new RegExp(hostname.replace('.', '\\.')));
  }
  for (const variable of [
    'BRIDGE_PUBLIC_HOST',
    'KEYCLOAK_PUBLIC_HOST',
    'OPENPROJECT_GATEWAY_HOST',
  ]) assert.match(caddyfile, new RegExp(`\\{\\$${variable}\\}`));
  assert.match(compose, /127\.0\.0\.1:8090:8090/);
});

test('Bridge config uses absolute oidc-provider route paths', async () => {
  const server = await readFile(path.join(bridgeRoot, 'src', 'server.js'), 'utf8');

  for (const route of ['auth', 'token', 'userinfo', 'jwks', 'session/end']) {
    assert.match(server, new RegExp(`['\"]/${route.replace('/', '\\/')}['\"]`));
  }
});

test('Keycloak realm brokers Bridge and owns the native OpenProject OIDC client', async () => {
  const realm = JSON.parse(await readFile(
    path.join(workspaceRoot, 'auth', 'keycloak', 'amperun-realm.json'),
    'utf8',
  ));

  assert.equal(realm.realm, 'amperun');
  assert.equal(realm.identityProviders[0].alias, 'wecom');
  assert.equal(realm.identityProviders[0].config.issuer, 'http://bridge.localhost:8090');
  assert.equal(realm.identityProviders[0].config.syncMode, 'FORCE');
  const openProjectClient = realm.clients.find((client) => client.clientId === 'openproject');
  assert.ok(openProjectClient.redirectUris.includes('http://openproject.localhost:8090/auth/keycloak/callback'));
  assert.ok(openProjectClient.defaultClientScopes.includes('profile'));
  assert.ok(openProjectClient.defaultClientScopes.includes('email'));
  assert.ok(openProjectClient.protocolMappers.some((mapper) => mapper.protocolMapper === 'oidc-group-membership-mapper'));
  assert.equal(realm.clients.some((client) => client.clientId === 'openproject-proxy'), false);
});

test('OpenProject overlay enables its native OIDC provider for WeCom', async () => {
  const compose = await readFile(
    path.join(openProjectRoot, 'docker', 'poc', 'wecom-sso', 'docker-compose.yml'),
    'utf8',
  );

  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_DISPLAY__NAME: 企业微信/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_IDENTIFIER: openproject/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_SECRET:/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_AUTHORIZATION__ENDPOINT:/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_TOKEN__ENDPOINT:/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_USERINFO__ENDPOINT:/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_JWKS__URI:/);
  assert.match(compose, /OPENPROJECT_OPENID__CONNECT_KEYCLOAK_LIMIT__SELF__REGISTRATION: "false"/);
  assert.match(compose, /OPENPROJECT_ADDITIONAL__HOST__NAMES/);
  assert.doesNotMatch(compose, /OPENPROJECT_AUTH__SOURCE__SSO_HEADER/);
  assert.doesNotMatch(compose, /OPENPROJECT_SEED__LDAP/);
  assert.doesNotMatch(compose, /OPENPROJECT_NATIVE__SSO__PROVIDERS__DISABLED/);
  assert.doesNotMatch(compose, /OPENPROJECT_SEED__ENTERPRISE__TOKEN/);
  assert.doesNotMatch(compose, /BEGIN LICENSE|CorpSecret|corpsecret/i);
});

test('OpenProject overlay enables the community knowledge base and collaborative editor', async () => {
  const compose = await readFile(
    path.join(openProjectRoot, 'docker', 'poc', 'wecom-sso', 'docker-compose.yml'),
    'utf8',
  );
  const bootstrap = await readFile(
    path.join(
      openProjectRoot,
      'docker',
      'poc',
      'wecom-sso',
      'configure-community-knowledge-base.rb',
    ),
    'utf8',
  );

  assert.match(compose, /OPENPROJECT_COLLABORATIVE__EDITING__HOCUSPOCUS__URL/);
  assert.match(compose, /OPENPROJECT_COLLABORATIVE__EDITING__HOCUSPOCUS__SECRET/);
  assert.match(compose, /OPENPROJECT_REAL__TIME__TEXT__COLLABORATION__ENABLED: "true"/);
  assert.match(compose, /^  hocuspocus:/m);
  assert.match(compose, /openproject\/hocuspocus:17\.6\.0@sha256:[a-f0-9]{64}/);
  assert.match(compose, /OPENPROJECT_URL: http:\/\/op-web:8080/);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:1234\/hocuspocus'\)/);
  assert.match(compose, /^  op-community-feature-config:/m);
  assert.match(compose, /configure-community-knowledge-base\.rb/);

  assert.match(bootstrap, /Role::BUILTIN_NON_MEMBER/);
  for (const permission of ['edit_wiki_pages', 'view_documents', 'manage_documents']) {
    assert.match(bootstrap, new RegExp(permission));
  }
  assert.match(bootstrap, /Project\.active\.where\(public: true\)/);
  assert.match(bootstrap, /find_or_create_by!\(name: module_name\)/);
  assert.match(bootstrap, /create_wiki!/);
  assert.match(bootstrap, /unless Setting\.real_time_text_collaboration_enabled\?/);
  assert.match(bootstrap, /collaborative_editing_hocuspocus_secret\.present\?/);
  assert.doesNotMatch(bootstrap, /Setting\.real_time_text_collaboration_enabled =/);
  assert.doesNotMatch(bootstrap, /BUILTIN_ANONYMOUS/);
});

test('OpenProject image builds Enterprise unlock and BlockNote fixes from one 17.8 source tree', async () => {
  const overlayRoot = path.join(
    openProjectRoot,
    'docker',
    'poc',
    'wecom-sso',
  );
  const compose = await readFile(path.join(overlayRoot, 'docker-compose.yml'), 'utf8');
  const dockerfile = await readFile(path.join(openProjectRoot, 'docker', 'prod', 'Dockerfile'), 'utf8');
  const sourceStyles = await readFile(
    path.join(
      openProjectRoot,
      'modules',
      'documents',
      'app',
      'assets',
      'stylesheets',
      '_index.sass',
    ),
    'utf8',
  );
  const shadowRangePatch = await readFile(
    path.join(openProjectRoot, 'frontend', 'src', 'app', 'core', 'setup', 'init-js-patches.ts'),
    'utf8',
  );

  assert.match(compose, /image: amperun\/openproject:17\.8\.0-unlocked/);
  assert.match(compose, /dockerfile: docker\/prod\/Dockerfile/);
  assert.match(compose, /target: slim-unlocked/);
  assert.match(compose, /OPENPROJECT_ENTERPRISE__FEATURES__UNLOCKED: "true"/);
  assert.doesNotMatch(compose, /OPENPROJECT_NATIVE__SSO__PROVIDERS__DISABLED/);
  assert.match(dockerfile, /^FROM slim AS slim-unlocked$/m);
  assert.match(dockerfile, /OPENPROJECT_ENTERPRISE__FEATURES__UNLOCKED=true/);
  assert.match(sourceStyles, /^op-block-note\n  display: block\n  width: 100%$/m);
  assert.match(
    shadowRangePatch,
    /ShadowRoot\.prototype\.createRange = document\.createRange\.bind\(document\)/,
  );
  assert.doesNotMatch(compose, /Dockerfile\.openproject|install-block-note-host-patch/);
});

test('auth compose connects Bridge, Keycloak, and native OpenProject OIDC', async () => {
  const compose = await readFile(path.join(workspaceRoot, 'auth', 'docker-compose.yml'), 'utf8');
  const caddyfile = await readFile(path.join(workspaceRoot, 'auth', 'proxy', 'Caddyfile'), 'utf8');
  const keycloakConfigScript = await readFile(
    path.join(workspaceRoot, 'auth', 'keycloak', 'configure-clients.sh'),
    'utf8',
  );

  assert.match(compose, /^  keycloak-client-config:/m);
  assert.doesNotMatch(compose, /^  directory:/m);
  assert.doesNotMatch(compose, /^  directory-acl-config:/m);
  assert.doesNotMatch(compose, /^  openproject-auth:/m);
  assert.doesNotMatch(compose, /^  openproject-header-gateway:/m);
  assert.doesNotMatch(compose, /OAUTH2_PROXY_|LDAP_/);
  assert.match(caddyfile, /reverse_proxy op-web:8080/);
  assert.match(caddyfile, /header_up -X-OpenProject-User/);
  assert.match(compose, /KEYCLOAK_BROKER_CLIENT_SECRET: \$\{KEYCLOAK_BROKER_CLIENT_SECRET:-/);
  assert.match(compose, /OPENPROJECT_OIDC_CLIENT_SECRET: \$\{OPENPROJECT_OIDC_CLIENT_SECRET:-/);
  assert.match(compose, /BRIDGE_ISSUER: \$\{BRIDGE_ISSUER:-/);
  assert.match(compose, /KEYCLOAK_PUBLIC_URL: \$\{KEYCLOAK_PUBLIC_URL:-/);
  assert.match(compose, /OPENPROJECT_PUBLIC_URL: \$\{OPENPROJECT_PUBLIC_URL:-/);
  assert.match(compose, /KEYCLOAK_BROKER_REDIRECT_URI:/);
  assert.match(compose, /WECOM_MODE: \$\{WECOM_MODE:-mock\}/);
  assert.match(keycloakConfigScript, /identity-provider\/instances\/wecom/);
  assert.match(keycloakConfigScript, /clientId=openproject/);
  assert.match(keycloakConfigScript, /OPENPROJECT_OIDC_CLIENT_SECRET/);
  assert.match(keycloakConfigScript, /config\.authorizationUrl=\$\{BRIDGE_ISSUER\}\/auth/);
  assert.match(keycloakConfigScript, /redirectUris=.*OPENPROJECT_PUBLIC_URL.*auth\/keycloak\/callback/);
  assert.match(keycloakConfigScript, /clients\/\$\{client_uuid\}/);
  assert.match(keycloakConfigScript, /wecom-only-browser/);
  assert.match(keycloakConfigScript, /identity-provider-redirector/);
  assert.match(keycloakConfigScript, /browserFlow=/);
  assert.match(keycloakConfigScript, /account-console/);
  assert.match(compose, /hocuspocus:\n\s+condition: service_healthy/);
});

test('native OpenProject OIDC shares only its private IdP network with Keycloak', async () => {
  const authCompose = path.join(workspaceRoot, 'auth', 'docker-compose.yml');
  const openProjectCompose = path.join(
    openProjectRoot,
    'docker',
    'poc',
    'wecom-sso',
    'docker-compose.yml',
  );
  const invocation = dockerComposeArgs([
    '--env-file', path.join(workspaceRoot, 'auth', '.env.example'),
    '-p', 'amperun-sso-contract',
    '-f', authCompose,
    '-f', openProjectCompose,
    'config',
    '--format', 'json',
  ]);
  const { stdout } = await execFileAsync(invocation.command, invocation.args, {
    env: { ...process.env, OPENPROJECT_SOURCE_DIR: openProjectRoot },
  });
  const config = JSON.parse(stdout);
  const networksFor = (service) => new Set(Object.keys(config.services[service].networks || {}));
  const webNetworks = networksFor('op-web');
  const bootstrapMount = config.services['op-community-feature-config'].volumes.find(
    (volume) => volume.target === '/opt/amperun/configure-community-knowledge-base.rb',
  );

  assert.ok(bootstrapMount, 'knowledge-base bootstrap script must be mounted');
  await readFile(bootstrapMount.source, 'utf8');
  assert.equal(config.services['op-web'].build.context, openProjectRoot);

  const bridgeShared = [...networksFor('bridge')].filter((network) => webNetworks.has(network));
  const keycloakShared = [...networksFor('keycloak')].filter((network) => webNetworks.has(network));
  assert.deepEqual(bridgeShared, []);
  assert.deepEqual(keycloakShared, ['openproject-idp-backplane']);
  assert.equal(webNetworks.has('default'), false);
  for (const network of [
    'openproject-collaboration-backplane',
    'openproject-collaboration-edge',
    'openproject-idp-backplane',
    'openproject-edge-backplane',
    'openproject-runtime',
  ]) assert.equal(config.networks[network].internal, true, `${network} must be internal`);

  const hocuspocusNetworks = networksFor('hocuspocus');
  assert.deepEqual(
    [...hocuspocusNetworks].sort(),
    ['openproject-collaboration-backplane', 'openproject-collaboration-edge'],
  );
  assert.equal(networksFor('gateway').has('openproject-collaboration-edge'), true);
  assert.equal(webNetworks.has('openproject-collaboration-backplane'), true);
  assert.equal(webNetworks.has('openproject-idp-backplane'), true);
});

test('gateway routes native OpenProject and collaborative WebSockets separately', async () => {
  const caddyfile = await readFile(path.join(workspaceRoot, 'auth', 'proxy', 'Caddyfile'), 'utf8');

  assert.match(caddyfile, /@openprojectCollaboration/);
  assert.match(caddyfile, /path \/hocuspocus\*/);
  assert.match(caddyfile, /reverse_proxy hocuspocus:1234/);
  assert.match(caddyfile, /reverse_proxy op-web:8080/);
  assert.doesNotMatch(
    caddyfile.match(/@openprojectCollaboration[\s\S]*?\n\s*}/)?.[0] ?? '',
    /X-OpenProject-User/,
  );
});

test('Makefile defines non-destructive stop and volume-removing destroy targets', async () => {
  const makefile = await readFile(path.join(workspaceRoot, 'auth', 'Makefile'), 'utf8');
  const waitScript = await readFile(path.join(bridgeRoot, 'scripts', 'wait-for-stack.mjs'), 'utf8');
  const runtimeSmoke = await readFile(path.join(bridgeRoot, 'scripts', 'runtime-smoke.mjs'), 'utf8');
  const networkSmoke = await readFile(path.join(bridgeRoot, 'scripts', 'network-smoke.mjs'), 'utf8');

  assert.match(makefile, /^down:/m);
  assert.match(makefile, /^destroy:/m);
  assert.match(makefile, /^reset: destroy up$/m);
  assert.doesNotMatch(makefile, /^realm-reset:/m);
  assert.match(makefile, /^deps:/m);
  assert.match(makefile, /^compose-preflight:/m);
  assert.match(makefile, /^source-preflight:/m);
  assert.match(makefile, /^up: \$\(ENV_FILE\) compose-preflight source-preflight$/m);
  assert.match(makefile, /validate-source-tree\.sh/);
  assert.match(makefile, /cd .*\/bridge && npm ci/);
  assert.match(makefile, /^test: deps$/m);
  assert.match(makefile, /OPENPROJECT_DIR \?= \$\(WORKSPACE_DIR\)/);
  assert.match(makefile, /PROJECT_NAME \?= amperun-sso-fork/);
  assert.match(makefile, /docker compose version --short/);
  assert.match(makefile, /docker-compose version --short/);
  assert.match(makefile, /Docker Compose 2 or newer is required/);
  assert.match(makefile, /OPENPROJECT_SOURCE_DIR=\$\(OPENPROJECT_DIR\)/);
  assert.match(makefile, /STACK_COMPOSE_PROJECT=\$\(PROJECT_NAME\).*network-smoke\.mjs/);
  assert.match(makefile, /up -d --build --wait --wait-timeout 300/);
  assert.match(makefile, /node .*wait-for-stack\.mjs/);
  assert.match(makefile, /node .*network-smoke\.mjs/);
  assert.match(makefile, /down --volumes --remove-orphans/);
  assert.doesNotMatch(makefile, /^\s*-docker volume rm/m);
  assert.match(waitScript, /openproject\.localhost:8090/);
  assert.match(waitScript, /path: '\/health_checks\/default'/);
  assert.match(waitScript, /path: '\/hocuspocus'/);
  assert.match(waitScript, /OpenProject collaboration/);
  assert.match(runtimeSmoke, /\/hocuspocus/);
  assert.match(runtimeSmoke, /Welcome to Hocuspocus!/);
  assert.match(runtimeSmoke, /\/auth\/keycloak\//);
  assert.match(networkSmoke, /\.IPAddress/);
  assert.match(networkSmoke, /node:net/);
  assert.match(networkSmoke, /webIpAddresses/);
  assert.match(networkSmoke, /openproject-idp-backplane/);
});

test('README documents native OpenProject OIDC without an Enterprise token', async () => {
  const readme = await readFile(path.join(workspaceRoot, 'auth', 'README.md'), 'utf8');

  assert.match(readme, /OpenProject 原生 OIDC/);
  assert.match(readme, /企业微信 -> Bridge -> Keycloak -> OpenProject/);
  assert.doesNotMatch(readme, /oauth2-proxy|Header SSO|LDAP Auth Source/);
  assert.doesNotMatch(readme, /OPENPROJECT_ENTERPRISE_TOKEN/);
  assert.doesNotMatch(readme, /realms\/amperun\/account/);
  assert.doesNotMatch(readme, /realm-reset/);
  assert.match(readme, /make -C auth reset/);
});

test('Docker runtime images are pinned to immutable digests', async () => {
  const authCompose = await readFile(path.join(workspaceRoot, 'auth', 'docker-compose.yml'), 'utf8');
  const openProjectCompose = await readFile(
    path.join(openProjectRoot, 'docker', 'poc', 'wecom-sso', 'docker-compose.yml'),
    'utf8',
  );
  const dockerfile = await readFile(path.join(bridgeRoot, 'Dockerfile'), 'utf8');

  const authImageLines = authCompose.split('\n').filter((line) => /^\s+image:\s+/.test(line));
  assert.ok(authImageLines.length > 0);
  for (const line of authImageLines) assert.match(line, /@sha256:[a-f0-9]{64}$/);

  const openProjectImageLines = openProjectCompose
    .split('\n')
    .filter((line) => /^\s+image:\s+/.test(line));
  assert.ok(openProjectImageLines.length > 0);
  for (const line of openProjectImageLines) {
    if (line.includes('amperun/openproject:')) continue;
    assert.match(line, /@sha256:[a-f0-9]{64}$/);
  }
  const openProjectDockerfile = await readFile(
    path.join(openProjectRoot, 'docker', 'prod', 'Dockerfile'),
    'utf8',
  );
  assert.match(openProjectDockerfile, /^ARG RUBY_IMAGE_DIGEST="sha256:[a-f0-9]{64}"$/m);
  assert.match(openProjectDockerfile, /^FROM ruby:\$\{RUBY_VERSION\}-slim-trixie@\$\{RUBY_IMAGE_DIGEST\}/m);
  assert.match(openProjectDockerfile, /^FROM slim AS slim-unlocked$/m);
  assert.match(dockerfile.split('\n')[0], /^FROM .+@sha256:[a-f0-9]{64}$/);
});

test('administrator guide covers secret reconciliation and application entitlement', async () => {
  const guide = await readFile(
    path.join(workspaceRoot, 'auth', 'docs', 'wecom-admin-setup.md'),
    'utf8',
  );

  for (const setting of [
    'KEYCLOAK_BROKER_CLIENT_SECRET',
    'OPENPROJECT_OIDC_CLIENT_SECRET',
    'WECOM_ALLOWED_USER_IDS',
    'BRIDGE_ISSUER',
    'KEYCLOAK_BROKER_REDIRECT_URI',
    '/auth/keycloak/callback',
    'keycloak-client-config',
    '企业可信 IP',
    '60020',
  ]) assert.match(guide, new RegExp(setting.replaceAll('/', '\\/')));
});
