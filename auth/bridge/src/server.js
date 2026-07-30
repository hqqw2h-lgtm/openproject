import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import express from 'express';
import { Provider } from 'oidc-provider';

import { AccountDirectory, JsonFileIdentityRegistry } from './accounts.js';
import { escapeHtml } from './html.js';
import { assertInteractionUid } from './interaction.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { buildWeComAuthorizeUrl, ExpiringStateStore, WeComClient } from './wecom.js';

const defaultAccounts = [
  {
    corpId: 'ww-amperun-local',
    personId: 'person-alice',
    userId: 'alice',
    name: 'Alice Zhang',
    email: 'alice@amperun.local',
    departmentNames: ['Engineering'],
    allowedApplications: ['openproject'],
    active: true,
  },
  {
    corpId: 'ww-amperun-local',
    personId: 'person-bob',
    userId: 'bob',
    name: 'Bob Li',
    email: 'bob@amperun.local',
    departmentNames: ['Delivery'],
    allowedApplications: ['openproject'],
    active: true,
  },
];

export function loadMockAccounts(environment = process.env) {
  if (!environment.MOCK_ACCOUNTS_JSON) return defaultAccounts;
  return JSON.parse(environment.MOCK_ACCOUNTS_JSON);
}

function signingKey() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    ...privateKey.export({ format: 'jwk' }),
    alg: 'RS256',
    kid: randomBytes(8).toString('hex'),
    use: 'sig',
  };
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f3f5f7; color: #17202a; }
    main { width: min(440px, calc(100% - 32px)); margin: 10vh auto; background: #fff; border: 1px solid #d7dce1; border-radius: 8px; padding: 28px; box-sizing: border-box; }
    h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: 0; }
    p { margin: 0 0 20px; color: #55606d; line-height: 1.5; }
    form + form { margin-top: 10px; }
    button, a.action { width: 100%; min-height: 44px; border: 1px solid #08783e; border-radius: 4px; background: #08783e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; display: grid; place-items: center; text-decoration: none; box-sizing: border-box; }
    button:hover, a.action:hover { background: #056632; }
    small { display: block; margin-top: 20px; color: #6b7580; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export async function findDirectoryAccount(directory, _ctx, subject) {
  const account = directory.findBySubject(subject);
  if (!account) return undefined;
  return { accountId: subject, claims: async () => account };
}

export function interactionUrl(_ctx, interaction) {
  return `/interaction/${interaction.uid}`;
}

export function createBridgeProvider(runtimeConfig, directory) {
  const secureCookies = new URL(runtimeConfig.issuer).protocol === 'https:';
  const provider = new Provider(runtimeConfig.issuer, {
    clients: [{
      client_id: 'keycloak-broker',
      client_secret: runtimeConfig.keycloakBrokerClientSecret,
      redirect_uris: [runtimeConfig.keycloakBrokerRedirectUri],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_post',
    }],
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'given_name', 'family_name', 'preferred_username'],
      groups: ['groups'],
    },
    cookies: {
      keys: runtimeConfig.cookieKeys,
      long: { secure: secureCookies },
      short: { secure: secureCookies },
    },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: true },
    },
    findAccount: findDirectoryAccount.bind(undefined, directory),
    interactions: { url: interactionUrl },
    jwks: { keys: [signingKey()] },
    routes: {
      authorization: '/auth',
      token: '/token',
      userinfo: '/userinfo',
      jwks: '/jwks',
      end_session: '/session/end',
    },
    scopes: ['openid', 'profile', 'email', 'groups'],
    ttl: {
      AccessToken: 5 * 60,
      AuthorizationCode: 60,
      Grant: 60 * 60,
      IdToken: 5 * 60,
      Interaction: 10 * 60,
      Session: 60 * 60,
    },
  });
  provider.proxy = true;
  return provider;
}

export function createBridgeApp({
  runtimeConfig,
  provider,
  directory,
  states = new ExpiringStateStore(),
  createWeComClient = (options) => new WeComClient(options),
  logger = console,
}) {
  const {
    allowedUserIds,
    callbackUrl,
    issuer,
    mode,
  } = runtimeConfig;
  const app = express();
  app.set('trust proxy', true);

  app.get('/health', (_req, res) => res.json({
    status: 'ok',
    mode,
    issuer,
  }));

  app.get('/interaction/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { prompt, params, session } = details;

      if (prompt.name === 'consent') {
        let grant = details.grantId ? await provider.Grant.find(details.grantId) : undefined;
        if (!grant) grant = new provider.Grant({ accountId: session.accountId, clientId: params.client_id });
        if (prompt.details.missingOIDCScope) grant.addOIDCScope(prompt.details.missingOIDCScope.join(' '));
        const grantId = await grant.save();
        return provider.interactionFinished(
          req,
          res,
          { consent: { grantId } },
          { mergeWithLastSubmission: true },
        );
      }

      if (prompt.name !== 'login') throw new Error(`Unsupported OIDC prompt: ${prompt.name}`);

      if (mode === 'wecom') {
        return res.send(htmlPage('企业微信登录', `
          <h1>企业微信登录</h1>
          <p>使用企业微信完成统一身份验证。</p>
          <a class="action" href="/interaction/${encodeURIComponent(req.params.uid)}/wecom">企业微信登录</a>
        `));
      }

      const forms = directory.all().map((account) => `
        <form method="post" action="/interaction/${encodeURIComponent(req.params.uid)}/mock-login">
          <input type="hidden" name="subject" value="${escapeHtml(account.sub)}">
          <button type="submit">${escapeHtml(account.name)} · ${escapeHtml(account.email)}</button>
        </form>
      `).join('');
      return res.send(htmlPage('本地企业微信身份', `
        <h1>选择企业微信测试用户</h1>
        <p>本地 Mock 身份源</p>
        ${forms}
        <small>issuer: ${escapeHtml(issuer)}</small>
      `));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/interaction/:uid/mock-login', express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      if (mode !== 'mock') return res.sendStatus(404);
      const account = directory.findBySubject(req.body.subject);
      if (!account) return res.status(400).send('Unknown account');
      return await provider.interactionFinished(
        req,
        res,
        { login: { accountId: account.sub, remember: false } },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      return next(error);
    }
  });

  app.get('/interaction/:uid/wecom', async (req, res, next) => {
    try {
      if (mode !== 'wecom') return res.sendStatus(404);
      const details = await provider.interactionDetails(req, res);
      assertInteractionUid(req.params.uid, details.uid);
      const state = randomBytes(24).toString('base64url');
      states.put(state, { interactionUid: details.uid });
      return res.redirect(buildWeComAuthorizeUrl({
        style: runtimeConfig.authStyle,
        corpId: runtimeConfig.wecomCorpId,
        agentId: runtimeConfig.wecomAgentId,
        redirectUri: callbackUrl,
        state,
      }));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/wecom/callback', async (req, res, next) => {
    try {
      const state = states.take(req.query.state);
      if (!state || typeof req.query.code !== 'string') {
        return res.status(400).send('Invalid or expired WeCom callback');
      }
      const details = await provider.interactionDetails(req, res);
      assertInteractionUid(state.interactionUid, details.uid);
      const client = createWeComClient({
        corpId: runtimeConfig.wecomCorpId,
        agentId: runtimeConfig.wecomAgentId,
        secret: runtimeConfig.wecomAppSecret,
      });
      const rawAccount = await client.resolveAuthorizationCode(req.query.code);
      rawAccount.allowedApplications = allowedUserIds.has(rawAccount.userId.toLowerCase()) ? ['openproject'] : [];
      const account = directory.upsert(rawAccount);
      return provider.interactionFinished(
        req,
        res,
        { login: { accountId: account.sub, remember: false } },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      return next(error);
    }
  });

  app.use(provider.callback());
  app.use((error, _req, res, _next) => {
    logger.error(error);
    res.status(500).send(htmlPage('登录失败', '<h1>登录失败</h1><p>身份桥接服务无法完成本次登录。</p>'));
  });
  return app;
}

export function buildBridge({ environment = process.env, logger = console } = {}) {
  const runtimeConfig = loadRuntimeConfig(environment);
  const identityRegistry = new JsonFileIdentityRegistry(runtimeConfig.identityRegistryPath);
  const directory = new AccountDirectory(loadMockAccounts(environment), { identityRegistry });
  const provider = createBridgeProvider(runtimeConfig, directory);
  const app = createBridgeApp({ runtimeConfig, provider, directory, logger });
  return { app, directory, provider, runtimeConfig };
}

export function startBridge({
  environment = process.env,
  host = '0.0.0.0',
  logger = console,
} = {}) {
  const bridge = buildBridge({ environment, logger });
  const server = bridge.app.listen(bridge.runtimeConfig.port, host, () => {
    logger.log(
      `WeCom Identity Bridge listening on ${bridge.runtimeConfig.port} `
      + `with issuer ${bridge.runtimeConfig.issuer} (${bridge.runtimeConfig.mode})`,
    );
  });
  return { ...bridge, server };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) startBridge();
