import assert from 'node:assert/strict';
import http from 'node:http';

const bridgeOrigin = 'http://bridge.localhost:8090';
const keycloakOrigin = 'http://keycloak.localhost:8090';
const openProjectOrigin = 'http://openproject.localhost:8090';
const openProjectAdminOrigin = 'http://openproject-admin.localhost:8090';

async function localRequest(origin, path, headers = {}, method = 'GET', body) {
  const host = new URL(origin).host;
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: 8090,
      path,
      method,
      headers: { ...headers, host },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          ok: response.statusCode >= 200 && response.statusCode < 300,
          headers: response.headers,
          text: () => body,
          json: () => JSON.parse(body),
        });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function getJson(origin, path) {
  const response = await localRequest(origin, path);
  assert.equal(response.ok, true, `${origin}${path} returned ${response.status}`);
  return response.json();
}

const bridge = await getJson(bridgeOrigin, '/.well-known/openid-configuration');
assert.equal(bridge.issuer, bridgeOrigin);

const keycloak = await getJson(keycloakOrigin, '/realms/amperun/.well-known/openid-configuration');
assert.ok(keycloak.scopes_supported.includes('profile'), 'Keycloak discovery must advertise profile');
assert.ok(keycloak.scopes_supported.includes('email'), 'Keycloak discovery must advertise email');

const authorizationUrl = new URL(keycloak.authorization_endpoint);
authorizationUrl.search = new URLSearchParams({
  client_id: 'openproject',
  redirect_uri: `${openProjectOrigin}/auth/keycloak/callback`,
  response_type: 'code',
  scope: 'openid profile email',
  state: 'runtime-smoke-state',
  nonce: 'runtime-smoke-nonce',
  prompt: 'none',
}).toString();
const authorization = await localRequest(keycloakOrigin, `${authorizationUrl.pathname}${authorizationUrl.search}`);
assert.equal(authorization.status, 302);
const location = authorization.headers.location;
assert.ok(location, 'Keycloak authorization response must have a location');
assert.equal(location.includes('invalid_scope'), false, location);

authorizationUrl.searchParams.delete('prompt');
authorizationUrl.searchParams.set('state', 'runtime-enforced-flow-state');
const enforcedBrowserFlow = await localRequest(
  keycloakOrigin,
  `${authorizationUrl.pathname}${authorizationUrl.search}`,
);
assert.ok([302, 303].includes(enforcedBrowserFlow.status));
assert.ok(
  enforcedBrowserFlow.headers.location?.includes('/broker/wecom/login'),
  `Keycloak browser flow did not enforce WeCom: ${enforcedBrowserFlow.headers.location}`,
);

const openProjectLogin = await localRequest(openProjectOrigin, '/login');
assert.equal(openProjectLogin.status, 200, `OpenProject login returned ${openProjectLogin.status}`);
assert.match(await openProjectLogin.text(), /企业微信/);

const openProjectOidc = await localRequest(openProjectOrigin, '/auth/keycloak/');
assert.ok([302, 303].includes(openProjectOidc.status), `OpenProject OIDC returned ${openProjectOidc.status}`);
assert.ok(
  openProjectOidc.headers.location?.startsWith(`${keycloakOrigin}/realms/amperun/protocol/openid-connect/auth`),
  `OpenProject OIDC did not redirect to Keycloak: ${openProjectOidc.headers.location}`,
);

const apiRequest = await localRequest(openProjectOrigin, '/api/v3/users/me', {
  authorization: `Basic ${Buffer.from('apikey:invalid').toString('base64')}`,
});
assert.notEqual(apiRequest.status, 302, 'OpenProject API authentication must not be redirected to Keycloak');

const oauthMetadata = await localRequest(openProjectOrigin, '/.well-known/oauth-authorization-server');
assert.equal(oauthMetadata.status, 200, 'OpenProject OAuth metadata must be available without browser login');

const protectedResource = await localRequest(openProjectOrigin, '/.well-known/oauth-protected-resource');
assert.equal(protectedResource.status, 200, 'OpenProject protected-resource metadata must be available');
assert.ok(
  (await protectedResource.json()).authorization_servers.includes(keycloak.issuer),
  'OpenProject must advertise the seeded Keycloak issuer',
);

const oauthToken = await localRequest(
  openProjectOrigin,
  '/oauth/token',
  { 'content-type': 'application/x-www-form-urlencoded' },
  'POST',
  'grant_type=client_credentials',
);
assert.notEqual(oauthToken.status, 302, 'OpenProject OAuth token requests must not be redirected to Keycloak');

const hocuspocus = await localRequest(openProjectOrigin, '/hocuspocus');
assert.equal(hocuspocus.status, 200, `Hocuspocus route returned ${hocuspocus.status}`);
assert.equal(
  (await hocuspocus.text()).trim(),
  'Welcome to Hocuspocus!',
  'Hocuspocus route must bypass browser SSO and reach the collaboration server',
);

const adminLogin = await localRequest(openProjectAdminOrigin, '/login');
assert.notEqual(adminLogin.status, 400, 'Local emergency admin host must pass OpenProject host validation');

const openProjectHealth = await localRequest(openProjectAdminOrigin, '/health_checks/default');
assert.equal(openProjectHealth.ok, true, `OpenProject health returned ${openProjectHealth.status}`);

console.log(JSON.stringify({
  bridgeIssuer: bridge.issuer,
  keycloakIssuer: keycloak.issuer,
  openProjectHealth: (await openProjectHealth.text()).trim(),
  openProjectLoginStatus: openProjectLogin.status,
  openProjectOidcStatus: openProjectOidc.status,
  apiStatus: apiRequest.status,
  oauthMetadataStatus: oauthMetadata.status,
  protectedResourceStatus: protectedResource.status,
  oauthTokenStatus: oauthToken.status,
  hocuspocusStatus: hocuspocus.status,
  adminLoginStatus: adminLogin.status,
  authorizationResult: new URL(location).searchParams.get('error') || 'code',
  enforcedBrowserFlowStatus: enforcedBrowserFlow.status,
}));
