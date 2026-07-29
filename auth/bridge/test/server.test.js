import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

import { AccountDirectory } from '../src/accounts.js';
import {
  buildBridge,
  createBridgeApp,
  createBridgeProvider,
  findDirectoryAccount,
  interactionUrl,
  loadMockAccounts,
  startBridge,
} from '../src/server.js';
import { ExpiringStateStore } from '../src/wecom.js';

function rawAccount(overrides = {}) {
  return {
    personId: 'person-alice',
    corpId: 'ww-amperun',
    userId: 'alice',
    name: 'Alice Zhang',
    email: 'alice@example.com',
    departmentNames: ['Engineering'],
    allowedApplications: ['openproject'],
    active: true,
    ...overrides,
  };
}

function runtimeConfig(overrides = {}) {
  return {
    allowedUserIds: new Set(['alice']),
    authStyle: 'qr',
    callbackUrl: 'https://bridge.example.com/wecom/callback',
    cookieKeys: ['cookie-key'],
    identityRegistryPath: '/tmp/unused-identities.json',
    issuer: 'https://bridge.example.com',
    keycloakBrokerClientSecret: 'broker-secret',
    keycloakBrokerRedirectUri: 'https://keycloak.example.com/broker/wecom/endpoint',
    mode: 'mock',
    port: 0,
    wecomAgentId: '1000002',
    wecomAppSecret: 'wecom-secret',
    wecomCorpId: 'ww-amperun',
    ...overrides,
  };
}

function fakeProvider(details) {
  const finished = [];
  const grants = [];
  class Grant {
    static async find(id) {
      return id === 'existing-grant' ? new Grant({ id }) : undefined;
    }

    constructor(data) {
      this.data = data;
      this.scopes = [];
      grants.push(this);
    }

    addOIDCScope(scope) {
      this.scopes.push(scope);
    }

    async save() {
      return this.data.id || 'new-grant';
    }
  }

  return {
    Grant,
    finished,
    grants,
    proxy: false,
    callback: () => (_req, res) => res.sendStatus(404),
    interactionDetails: async (req) => (
      typeof details === 'function' ? details(req) : details
    ),
    interactionFinished: async (_req, res, result, options) => {
      finished.push({ result, options });
      return res.json(result);
    },
  };
}

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves health and completes mock login interactions', async (t) => {
  const provider = fakeProvider({ prompt: { name: 'login' } });
  const directory = new AccountDirectory([rawAccount()]);
  const app = createBridgeApp({ runtimeConfig: runtimeConfig(), provider, directory });
  const baseUrl = await serve(t, app);

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.deepEqual(health, {
    status: 'ok',
    mode: 'mock',
    issuer: 'https://bridge.example.com',
  });

  const loginPage = await fetch(`${baseUrl}/interaction/interaction-1`).then((response) => response.text());
  assert.match(loginPage, /Alice Zhang/);
  assert.match(loginPage, /alice@example\.com/);

  const unknown = await fetch(`${baseUrl}/interaction/interaction-1/mock-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'subject=missing',
  });
  assert.equal(unknown.status, 400);

  const account = directory.all()[0];
  const completed = await fetch(`${baseUrl}/interaction/interaction-1/mock-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subject: account.sub }),
  }).then((response) => response.json());
  assert.deepEqual(completed, { login: { accountId: account.sub, remember: false } });

  assert.equal((await fetch(`${baseUrl}/interaction/interaction-1/wecom`)).status, 404);
});

test('sanitizes errors raised while completing a mock login', async (t) => {
  const errors = [];
  const provider = fakeProvider({ prompt: { name: 'login' } });
  provider.interactionFinished = async () => {
    throw new Error('provider completion failed');
  };
  const directory = new AccountDirectory([rawAccount()]);
  const app = createBridgeApp({
    runtimeConfig: runtimeConfig(),
    provider,
    directory,
    logger: { error: (error) => errors.push(error) },
  });
  const baseUrl = await serve(t, app);
  const account = directory.all()[0];

  const response = await fetch(`${baseUrl}/interaction/interaction-1/mock-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subject: account.sub }),
  });
  assert.equal(response.status, 500);
  assert.match(await response.text(), /登录失败/);
  assert.match(errors[0].message, /provider completion failed/);
});

test('renders WeCom login and handles new and existing consent grants', async (t) => {
  let currentDetails = {
    prompt: { name: 'login' },
    params: {},
    session: {},
  };
  const provider = fakeProvider(() => currentDetails);
  const app = createBridgeApp({
    runtimeConfig: runtimeConfig({ mode: 'wecom' }),
    provider,
    directory: new AccountDirectory(),
  });
  const baseUrl = await serve(t, app);

  const loginPage = await fetch(`${baseUrl}/interaction/interaction-2`).then((response) => response.text());
  assert.match(loginPage, /企业微信登录/);
  assert.equal((await fetch(`${baseUrl}/interaction/interaction-2/mock-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'subject=unused',
  })).status, 404);

  currentDetails = {
    prompt: { name: 'consent', details: { missingOIDCScope: ['openid', 'email'] } },
    params: { client_id: 'keycloak-broker' },
    session: { accountId: 'subject-1' },
  };
  await fetch(`${baseUrl}/interaction/interaction-2`);
  assert.deepEqual(provider.grants[0].data, {
    accountId: 'subject-1',
    clientId: 'keycloak-broker',
  });
  assert.deepEqual(provider.grants[0].scopes, ['openid email']);
  assert.equal(provider.finished.at(-1).result.consent.grantId, 'new-grant');

  currentDetails = {
    grantId: 'existing-grant',
    prompt: { name: 'consent', details: {} },
    params: { client_id: 'keycloak-broker' },
    session: { accountId: 'subject-1' },
  };
  await fetch(`${baseUrl}/interaction/interaction-2`);
  assert.equal(provider.finished.at(-1).result.consent.grantId, 'existing-grant');
});

test('rejects unsupported prompts through the sanitized error page', async (t) => {
  const errors = [];
  const provider = fakeProvider({ prompt: { name: 'select_account' } });
  const app = createBridgeApp({
    runtimeConfig: runtimeConfig(),
    provider,
    directory: new AccountDirectory(),
    logger: { error: (error) => errors.push(error) },
  });
  const baseUrl = await serve(t, app);

  const response = await fetch(`${baseUrl}/interaction/interaction-3`);
  assert.equal(response.status, 500);
  assert.match(await response.text(), /登录失败/);
  assert.match(errors[0].message, /Unsupported OIDC prompt/);
});

test('completes the state-bound WeCom callback for allowlisted employees', async (t) => {
  const provider = fakeProvider({
    uid: 'interaction-4',
    prompt: { name: 'login' },
  });
  const directory = new AccountDirectory();
  const states = new ExpiringStateStore();
  const app = createBridgeApp({
    runtimeConfig: runtimeConfig({ mode: 'wecom' }),
    provider,
    directory,
    states,
    createWeComClient: () => ({
      resolveAuthorizationCode: async () => rawAccount({ personId: undefined }),
    }),
  });
  const baseUrl = await serve(t, app);

  const redirect = await fetch(`${baseUrl}/interaction/interaction-4/wecom`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const state = new URL(redirect.headers.get('location')).searchParams.get('state');
  assert.ok(state);

  const result = await fetch(`${baseUrl}/wecom/callback?code=login-code&state=${state}`)
    .then((response) => response.json());
  assert.match(result.login.accountId, /^wecom-person:/);
  assert.equal(directory.findBySubject(result.login.accountId).email, 'alice@example.com');

  const replay = await fetch(`${baseUrl}/wecom/callback?code=login-code&state=${state}`);
  assert.equal(replay.status, 400);
});

test('uses the default WeCom client for the production callback path', async (t) => {
  const provider = fakeProvider({ uid: 'interaction-7', prompt: { name: 'login' } });
  const directory = new AccountDirectory();
  const originalFetch = globalThis.fetch;
  const responses = [
    { access_token: 'access-token' },
    { userid: 'alice' },
    {
      userid: 'alice',
      name: 'Alice Zhang',
      biz_mail: 'alice@example.com',
      department: [1],
      status: 1,
    },
  ];
  globalThis.fetch = async (input, options) => {
    if (!String(input).startsWith('https://qyapi.weixin.qq.com/')) {
      return originalFetch(input, options);
    }
    return { ok: true, json: async () => responses.shift() };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const app = createBridgeApp({
    runtimeConfig: runtimeConfig({ mode: 'wecom' }),
    provider,
    directory,
  });
  const baseUrl = await serve(t, app);

  const redirect = await fetch(`${baseUrl}/interaction/interaction-7/wecom`, { redirect: 'manual' });
  const state = new URL(redirect.headers.get('location')).searchParams.get('state');
  const result = await fetch(`${baseUrl}/wecom/callback?code=login-code&state=${state}`)
    .then((response) => response.json());

  assert.match(result.login.accountId, /^wecom-person:/);
  assert.equal(directory.findBySubject(result.login.accountId).source.userId, 'alice');
  assert.equal(responses.length, 0);
});

test('rejects mismatched, malformed, and unauthorized WeCom callbacks', async (t) => {
  const errors = [];
  const provider = fakeProvider({ uid: 'different-interaction', prompt: { name: 'login' } });
  const states = new ExpiringStateStore();
  states.put('missing-code-state', { interactionUid: 'different-interaction' });
  const app = createBridgeApp({
    runtimeConfig: runtimeConfig({ mode: 'wecom', allowedUserIds: new Set() }),
    provider,
    directory: new AccountDirectory(),
    states,
    createWeComClient: () => ({
      resolveAuthorizationCode: async () => rawAccount({ personId: undefined }),
    }),
    logger: { error: (error) => errors.push(error) },
  });
  const baseUrl = await serve(t, app);

  assert.equal((await fetch(`${baseUrl}/wecom/callback`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/wecom/callback?state=missing-code-state`)).status, 400);
  const mismatch = await fetch(`${baseUrl}/interaction/interaction-5/wecom`);
  assert.equal(mismatch.status, 500);
  assert.match(errors[0].message, /OIDC interaction mismatch/);

  const unauthorizedErrors = [];
  const unauthorizedProvider = fakeProvider({ uid: 'interaction-6', prompt: { name: 'login' } });
  const unauthorizedApp = createBridgeApp({
    runtimeConfig: runtimeConfig({ mode: 'wecom', allowedUserIds: new Set() }),
    provider: unauthorizedProvider,
    directory: new AccountDirectory(),
    states: new ExpiringStateStore(),
    createWeComClient: () => ({
      resolveAuthorizationCode: async () => rawAccount({ personId: undefined }),
    }),
    logger: { error: (error) => unauthorizedErrors.push(error) },
  });
  const unauthorizedBaseUrl = await serve(t, unauthorizedApp);
  const redirect = await fetch(
    `${unauthorizedBaseUrl}/interaction/interaction-6/wecom`,
    { redirect: 'manual' },
  );
  const state = new URL(redirect.headers.get('location')).searchParams.get('state');
  const unauthorized = await fetch(
    `${unauthorizedBaseUrl}/wecom/callback?code=login-code&state=${state}`,
  );
  assert.equal(unauthorized.status, 500);
  assert.match(unauthorizedErrors[0].message, /not allowed to use OpenProject/);
});

test('builds the real provider and starts a mock Bridge on an ephemeral port', async (t) => {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'amperun-bridge-'));
  t.after(() => rmSync(directoryPath, { recursive: true, force: true }));
  const environment = {
    IDENTITY_REGISTRY_PATH: path.join(directoryPath, 'identities.json'),
    MOCK_ACCOUNTS_JSON: JSON.stringify([rawAccount()]),
    PORT: '0',
  };

  assert.equal(loadMockAccounts(environment)[0].email, 'alice@example.com');
  assert.equal(loadMockAccounts({}).length, 2);

  const bridge = buildBridge({ environment });
  assert.equal(bridge.provider.proxy, true);
  assert.equal(bridge.directory.all().length, 1);
  assert.equal(interactionUrl(undefined, { uid: 'interaction-8' }), '/interaction/interaction-8');
  const account = bridge.directory.all()[0];
  const providerAccount = await findDirectoryAccount(bridge.directory, undefined, account.sub);
  assert.equal(providerAccount.accountId, account.sub);
  assert.deepEqual(await providerAccount.claims(), account);
  assert.equal(
    await findDirectoryAccount(bridge.directory, undefined, 'missing-subject'),
    undefined,
  );

  const secureProvider = createBridgeProvider(runtimeConfig(), new AccountDirectory());
  assert.equal(secureProvider.proxy, true);

  const started = startBridge({ environment, host: '127.0.0.1' });
  await once(started.server, 'listening');
  t.after(() => started.server.close());
  const health = await fetch(`http://127.0.0.1:${started.server.address().port}/health`)
    .then((response) => response.json());
  assert.equal(health.status, 'ok');
});
