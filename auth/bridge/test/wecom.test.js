import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeComAuthorizeUrl, ExpiringStateStore } from '../src/wecom.js';

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
