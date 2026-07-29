import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeComAuthorizeUrl, ExpiringStateStore, WeComClient } from '../src/wecom.js';

test('builds a desktop WeCom QR login URL with an opaque state', () => {
  const url = new URL(buildWeComAuthorizeUrl({
    style: 'qr',
    corpId: 'ww-corp',
    agentId: '1000002',
    redirectUri: 'http://bridge.localhost:8090/wecom/callback',
    state: 'opaque-state',
  }));

  assert.equal(url.origin + url.pathname, 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect');
  assert.equal(url.searchParams.get('appid'), 'ww-corp');
  assert.equal(url.searchParams.get('agentid'), '1000002');
  assert.equal(url.searchParams.get('state'), 'opaque-state');
});

test('state values are single-use and expire', () => {
  let now = 1000;
  const states = new ExpiringStateStore({ ttlMs: 100, now: () => now });
  states.put('state-1', { interactionUid: 'interaction-1' });

  assert.deepEqual(states.take('state-1'), { interactionUid: 'interaction-1' });
  assert.equal(states.take('state-1'), undefined);

  states.put('state-2', { interactionUid: 'interaction-2' });
  now = 1200;
  assert.equal(states.take('state-2'), undefined);
});

test('builds an in-app WeCom authorization URL', () => {
  const url = new URL(buildWeComAuthorizeUrl({
    style: 'webview',
    corpId: 'ww-corp',
    agentId: '1000002',
    redirectUri: 'https://bridge.example.com/wecom/callback',
    state: 'opaque-state',
  }));

  assert.equal(url.origin + url.pathname, 'https://open.weixin.qq.com/connect/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'snsapi_privateinfo');
  assert.equal(url.hash, '#wechat_redirect');
});

test('resolves a WeCom authorization code into an account', async () => {
  const requests = [];
  const responses = [
    { access_token: 'access-token' },
    { userid: 'Alice' },
    {
      userid: 'Alice',
      name: 'Alice Zhang',
      biz_mail: 'alice@example.com',
      department: [1, 2],
      status: 1,
    },
  ];
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return { ok: true, json: async () => responses.shift() };
  };
  const client = new WeComClient({
    corpId: 'ww-corp',
    agentId: '1000002',
    secret: 'secret',
    fetchImpl,
  });

  assert.deepEqual(await client.resolveAuthorizationCode('login-code'), {
    corpId: 'ww-corp',
    userId: 'Alice',
    name: 'Alice Zhang',
    email: 'alice@example.com',
    departmentNames: ['wecom-1', 'wecom-2'],
    active: true,
  });
  assert.equal(requests[0].url.searchParams.get('corpsecret'), 'secret');
  assert.equal(requests[1].url.searchParams.get('code'), 'login-code');
  assert.equal(requests[2].url.searchParams.get('userid'), 'Alice');
  assert.deepEqual(requests[0].options, { headers: { accept: 'application/json' } });
});

test('falls back to the standard email and empty departments', async () => {
  const responses = [
    { access_token: 'access-token' },
    { userid: 'bob' },
    { userid: 'bob', name: 'Bob', email: 'bob@example.com', status: 2 },
  ];
  const client = new WeComClient({
    corpId: 'ww-corp',
    agentId: '1000002',
    secret: 'secret',
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift() }),
  });

  const account = await client.resolveAuthorizationCode('login-code');
  assert.equal(account.email, 'bob@example.com');
  assert.deepEqual(account.departmentNames, []);
  assert.equal(account.active, false);
});

test('surfaces WeCom HTTP and API failures and missing corporate identities', async () => {
  const clientFor = (responses) => new WeComClient({
    corpId: 'ww-corp',
    agentId: '1000002',
    secret: 'secret',
    fetchImpl: async () => responses.shift(),
  });

  await assert.rejects(
    clientFor([{ ok: false, status: 503 }]).resolveAuthorizationCode('code'),
    /WeCom HTTP 503/,
  );
  await assert.rejects(
    clientFor([{ ok: true, json: async () => ({ errcode: 40013 }) }])
      .resolveAuthorizationCode('code'),
    /WeCom API 40013: unknown error/,
  );
  await assert.rejects(
    clientFor([
      { ok: true, json: async () => ({ access_token: 'token' }) },
      { ok: true, json: async () => ({ errcode: 0 }) },
    ]).resolveAuthorizationCode('code'),
    /did not return a corporate userid/,
  );
});
