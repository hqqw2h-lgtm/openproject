import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const project = process.env.STACK_COMPOSE_PROJECT || 'amperun-sso';
const webContainer = `${project}-op-web-1`;
const bridgeContainer = `${project}-bridge-1`;
const keycloakContainer = `${project}-keycloak-1`;

async function containerNetworkDetails(container) {
  const { stdout } = await execFileAsync(
    'docker',
    ['inspect', container, '--format', '{{json .NetworkSettings.Networks}}'],
    { timeout: 30_000 },
  );
  return JSON.parse(stdout);
}

const webNetworkDetails = await containerNetworkDetails(webContainer);
const bridgeNetworkDetails = await containerNetworkDetails(bridgeContainer);
const keycloakNetworkDetails = await containerNetworkDetails(keycloakContainer);
const webNetworks = new Set(Object.keys(webNetworkDetails));
const bridgeNetworks = new Set(Object.keys(bridgeNetworkDetails));
const keycloakNetworks = new Set(Object.keys(keycloakNetworkDetails));
const bridgeSharedNetworks = [...bridgeNetworks].filter((network) => webNetworks.has(network));
const keycloakSharedNetworks = [...keycloakNetworks].filter((network) => webNetworks.has(network));
assert.deepEqual(bridgeSharedNetworks, [], `Bridge and op-web share networks: ${bridgeSharedNetworks.join(', ')}`);
assert.equal(keycloakSharedNetworks.length, 1, `Unexpected Keycloak/op-web networks: ${keycloakSharedNetworks.join(', ')}`);
assert.match(keycloakSharedNetworks[0], /openproject-idp-backplane$/);
const webIpAddresses = Object.values(webNetworkDetails).map((network) => network.IPAddress).filter(Boolean);
assert.ok(webIpAddresses.length > 0, 'op-web has no inspectable IP addresses');

const lookupMustFail = `
  require('node:dns').lookup('op-web', (error) => {
    const code = error && error.code;
    console.log(code || 'RESOLVED');
    process.exit(['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 0 : 1);
  });
`;

const bridgeLookup = await execFileAsync(
  'docker',
  ['exec', bridgeContainer, 'node', '-e', lookupMustFail],
  { timeout: 30_000 },
);

const directTcpMustFail = `
  const net = require('node:net');
  const host = process.argv[1];
  const socket = net.createConnection({ host, port: 8080 });
  const inaccessible = (result) => {
    console.log(result);
    socket.destroy();
    process.exit(0);
  };
  socket.setTimeout(1500);
  socket.once('connect', () => process.exit(1));
  socket.once('error', (error) => inaccessible(error.code || 'ERROR'));
  socket.once('timeout', () => inaccessible('TIMEOUT'));
`;

const bridgeDirectIpResults = {};
for (const address of webIpAddresses) {
  const result = await execFileAsync(
    'docker',
    ['exec', bridgeContainer, 'node', '-e', directTcpMustFail, address],
    { timeout: 10_000 },
  );
  bridgeDirectIpResults[address] = result.stdout.trim();
}

console.log(JSON.stringify({
  bridgeNetworks: [...bridgeNetworks].sort(),
  keycloakNetworks: [...keycloakNetworks].sort(),
  webNetworks: [...webNetworks].sort(),
  bridgeSharedNetworks,
  keycloakSharedNetworks,
  bridgeToWeb: bridgeLookup.stdout.trim(),
  bridgeDirectIpResults,
  webIpAddresses,
}));
