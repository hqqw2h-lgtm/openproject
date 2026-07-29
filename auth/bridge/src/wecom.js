const QR_AUTHORIZE_URL = 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect';
const WEB_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const API_BASE_URL = 'https://qyapi.weixin.qq.com/cgi-bin';

export function buildWeComAuthorizeUrl({ style, corpId, agentId, redirectUri, state }) {
  const url = new URL(style === 'webview' ? WEB_AUTHORIZE_URL : QR_AUTHORIZE_URL);
  url.searchParams.set(style === 'webview' ? 'appid' : 'appid', corpId);
  url.searchParams.set('agentid', agentId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  if (style === 'webview') {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_privateinfo');
    url.hash = 'wechat_redirect';
  }

  return url.toString();
}

export class ExpiringStateStore {
  #entries = new Map();

  constructor({ ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  put(key, value) {
    this.#entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  take(key) {
    const entry = this.#entries.get(key);
    this.#entries.delete(key);
    if (!entry || entry.expiresAt < this.now()) return undefined;
    return entry.value;
  }
}

async function fetchWeComJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`WeCom HTTP ${response.status}`);
  const body = await response.json();
  if (body.errcode && body.errcode !== 0) {
    throw new Error(`WeCom API ${body.errcode}: ${body.errmsg || 'unknown error'}`);
  }
  return body;
}

export class WeComClient {
  constructor({ corpId, agentId, secret, fetchImpl = fetch }) {
    this.corpId = corpId;
    this.agentId = agentId;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
  }

  async resolveAuthorizationCode(code) {
    const tokenUrl = new URL(`${API_BASE_URL}/gettoken`);
    tokenUrl.searchParams.set('corpid', this.corpId);
    tokenUrl.searchParams.set('corpsecret', this.secret);
    const { access_token: accessToken } = await fetchWeComJson(tokenUrl, this.fetchImpl);

    const identityUrl = new URL(`${API_BASE_URL}/auth/getuserinfo`);
    identityUrl.searchParams.set('access_token', accessToken);
    identityUrl.searchParams.set('code', code);
    const identity = await fetchWeComJson(identityUrl, this.fetchImpl);
    if (!identity.userid) throw new Error('WeCom did not return a corporate userid');

    const userUrl = new URL(`${API_BASE_URL}/user/get`);
    userUrl.searchParams.set('access_token', accessToken);
    userUrl.searchParams.set('userid', identity.userid);
    const user = await fetchWeComJson(userUrl, this.fetchImpl);

    return {
      corpId: this.corpId,
      userId: user.userid,
      name: user.name,
      email: user.biz_mail || user.email,
      departmentNames: (user.department || []).map((id) => `wecom-${id}`),
      active: user.status === 1,
    };
  }
}
