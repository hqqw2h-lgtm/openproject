import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntimeConfig } from '../src/runtime-config.js';

const realEnvironment = {
  BRIDGE_ISSUER: 'https://sso.example.com',
  BRIDGE_COOKIE_KEYS: 'replace-with-a-random-cookie-key',
  KEYCLOAK_BROKER_CLIENT_SECRET: 'replace-with-a-random-broker-secret',
  KEYCLOAK_BROKER_REDIRECT_URI: 'https://login.example.com/realms/amperun/broker/wecom/endpoint',
  WECOM_MODE: 'wecom',
  WECOM_AUTH_STYLE: 'qr',
  WECOM_CORP_ID: 'ww-example-corp',
  WECOM_AGENT_ID: '1000002',
  WECOM_APP_SECRET: 'replace-with-a-real-wecom-secret',
  WECOM_ALLOWED_USER_IDS: 'zhangsan,lisi',
};

test('loads an explicit HTTPS configuration for real WeCom mode', () => {
  const config = loadRuntimeConfig(realEnvironment);

  assert.equal(config.issuer, 'https://sso.example.com');
  assert.equal(config.callbackUrl, 'https://sso.example.com/wecom/callback');
  assert.equal(
    config.keycloakBrokerRedirectUri,
    'https://login.example.com/realms/amperun/broker/wecom/endpoint',
  );
  assert.deepEqual([...config.allowedUserIds], ['zhangsan', 'lisi']);
});

test('real WeCom mode fails fast when required identity settings are missing', () => {
  for (const setting of [
    'WECOM_CORP_ID',
    'WECOM_AGENT_ID',
    'WECOM_APP_SECRET',
    'WECOM_ALLOWED_USER_IDS',
    'BRIDGE_COOKIE_KEYS',
    'KEYCLOAK_BROKER_CLIENT_SECRET',
    'KEYCLOAK_BROKER_REDIRECT_URI',
  ]) {
    assert.throws(
      () => loadRuntimeConfig({ ...realEnvironment, [setting]: '' }),
      new RegExp(setting),
    );
  }
});

test('real WeCom mode rejects HTTP endpoints and local placeholder secrets', () => {
  assert.throws(
    () => loadRuntimeConfig({ ...realEnvironment, BRIDGE_ISSUER: 'http://sso.example.com' }),
    /BRIDGE_ISSUER must use HTTPS/,
  );
  assert.throws(
    () => loadRuntimeConfig({
      ...realEnvironment,
      KEYCLOAK_BROKER_REDIRECT_URI: 'http://login.example.com/realms/amperun/broker/wecom/endpoint',
    }),
    /KEYCLOAK_BROKER_REDIRECT_URI must use HTTPS/,
  );
  assert.throws(
    () => loadRuntimeConfig({ ...realEnvironment, WECOM_APP_SECRET: 'local-wecom-secret-change-me' }),
    /WECOM_APP_SECRET must not use a local placeholder/,
  );
});
