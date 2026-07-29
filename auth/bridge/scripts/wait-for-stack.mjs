import http from 'node:http';

const timeoutMs = Number(process.env.STACK_WAIT_TIMEOUT_MS || 300_000);
const retryMs = Number(process.env.STACK_WAIT_RETRY_MS || 1_000);

const checks = [
  { host: 'bridge.localhost:8090', path: '/health', name: 'Bridge' },
  {
    host: 'keycloak.localhost:8090',
    path: '/realms/amperun/.well-known/openid-configuration',
    name: 'Keycloak',
  },
  { host: 'openproject.localhost:8090', path: '/health_checks/default', name: 'OpenProject' },
  { host: 'openproject.localhost:8090', path: '/hocuspocus', name: 'OpenProject collaboration' },
];

function request({ host, path }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8090,
      path,
      method: 'GET',
      headers: { host },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.setTimeout(5_000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

const startedAt = Date.now();
let lastResults = [];

while (Date.now() - startedAt < timeoutMs) {
  lastResults = await Promise.all(checks.map(async (check) => {
    try {
      return { name: check.name, status: await request(check) };
    } catch (error) {
      return { name: check.name, error: error.code || error.message };
    }
  }));

  if (lastResults.every((result) => result.status === 200)) {
    console.log(`SSO stack ready in ${Date.now() - startedAt}ms`);
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, retryMs));
}

console.error(`SSO stack did not become ready within ${timeoutMs}ms: ${JSON.stringify(lastResults)}`);
process.exit(1);
