const LOCAL_BRIDGE_ISSUER = 'http://bridge.localhost:8090';
const LOCAL_KEYCLOAK_REDIRECT_URI =
  'http://keycloak.localhost:8090/realms/amperun/broker/wecom/endpoint';
const LOCAL_COOKIE_KEY = 'local-cookie-key-change-me';
const LOCAL_CLIENT_SECRET = 'local-bridge-secret-change-me';

function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required in real WeCom mode`);
  }
  return value.trim();
}

function httpsUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(required(value, name));
  } catch (error) {
    if (error.message.includes('is required')) throw error;
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS in real WeCom mode`);
  return parsed.toString().replace(/\/$/, '');
}

function productionSecret(value, name) {
  const secret = required(value, name);
  if (/^<.*>$|(?:^|[-_])(local|change-me|placeholder)(?:[-_]|$)/i.test(secret)) {
    throw new Error(`${name} must not use a local placeholder in real WeCom mode`);
  }
  return secret;
}

function parseAllowedUserIds(value) {
  return new Set((value || '')
    .split(',')
    .map((userId) => userId.trim().toLowerCase())
    .filter(Boolean));
}

export function loadRuntimeConfig(environment = process.env) {
  const mode = environment.WECOM_MODE || 'mock';
  const authStyle = environment.WECOM_AUTH_STYLE || 'qr';
  if (!['mock', 'wecom'].includes(mode)) throw new Error(`Unsupported WECOM_MODE: ${mode}`);
  if (!['qr', 'webview'].includes(authStyle)) throw new Error(`Unsupported WECOM_AUTH_STYLE: ${authStyle}`);

  let issuer = (environment.BRIDGE_ISSUER || LOCAL_BRIDGE_ISSUER).replace(/\/$/, '');
  let keycloakBrokerRedirectUri = environment.KEYCLOAK_BROKER_REDIRECT_URI || LOCAL_KEYCLOAK_REDIRECT_URI;
  let cookieKeys = environment.BRIDGE_COOKIE_KEYS || LOCAL_COOKIE_KEY;
  let keycloakBrokerClientSecret = environment.KEYCLOAK_BROKER_CLIENT_SECRET || LOCAL_CLIENT_SECRET;
  const allowedUserIds = parseAllowedUserIds(environment.WECOM_ALLOWED_USER_IDS);

  if (mode === 'wecom') {
    issuer = httpsUrl(issuer, 'BRIDGE_ISSUER');
    keycloakBrokerRedirectUri = httpsUrl(keycloakBrokerRedirectUri, 'KEYCLOAK_BROKER_REDIRECT_URI');
    cookieKeys = productionSecret(cookieKeys, 'BRIDGE_COOKIE_KEYS');
    keycloakBrokerClientSecret = productionSecret(
      keycloakBrokerClientSecret,
      'KEYCLOAK_BROKER_CLIENT_SECRET',
    );
    productionSecret(environment.WECOM_APP_SECRET, 'WECOM_APP_SECRET');
    required(environment.WECOM_CORP_ID, 'WECOM_CORP_ID');
    required(environment.WECOM_AGENT_ID, 'WECOM_AGENT_ID');
    required(environment.WECOM_ALLOWED_USER_IDS, 'WECOM_ALLOWED_USER_IDS');
    if (allowedUserIds.size === 0) {
      throw new Error('WECOM_ALLOWED_USER_IDS must contain at least one user in real WeCom mode');
    }
  }

  return {
    allowedUserIds,
    authStyle,
    callbackUrl: `${issuer}/wecom/callback`,
    cookieKeys: cookieKeys.split(',').map((key) => key.trim()).filter(Boolean),
    identityRegistryPath: environment.IDENTITY_REGISTRY_PATH || '/data/identity-registry.json',
    issuer,
    keycloakBrokerClientSecret,
    keycloakBrokerRedirectUri,
    mode,
    port: Number(environment.PORT || 3000),
    wecomAgentId: environment.WECOM_AGENT_ID,
    wecomAppSecret: environment.WECOM_APP_SECRET,
    wecomCorpId: environment.WECOM_CORP_ID,
  };
}
