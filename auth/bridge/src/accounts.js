import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const APP_GROUP = '/apps/openproject/users';

export class InvalidAccountError extends Error {}
export class InactiveAccountError extends Error {}
export class UnauthorizedAccountError extends Error {}

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidAccountError(`${field} is required`);
  }
  return value.trim();
}

function externalId(corpId, userId) {
  return `${required(corpId, 'corpId')}:${required(userId, 'userId').toLowerCase()}`;
}

function readableSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'wecom';
}

function stableUsername(personId) {
  const digest = createHash('sha256').update(required(personId, 'personId')).digest('hex').slice(0, 16);
  return `wecom-${digest}`;
}

export class IdentityRegistry {
  constructor(records = {}) {
    this.externalToPersonId = new Map(Object.entries(records));
  }

  resolve(corpId, userId, requestedPersonId) {
    const key = externalId(corpId, userId);
    const existing = this.externalToPersonId.get(key);
    if (existing && requestedPersonId && existing !== requestedPersonId) {
      throw new InvalidAccountError(`External identity ${key} is already linked`);
    }

    const personId = existing || requestedPersonId || randomUUID();
    if (!existing) {
      this.externalToPersonId.set(key, personId);
      this.persist();
    }
    return personId;
  }

  linkAlias(corpId, currentUserId, aliasUserId) {
    const currentKey = externalId(corpId, currentUserId);
    const personId = this.externalToPersonId.get(currentKey);
    if (!personId) throw new InvalidAccountError(`Unknown external identity ${currentKey}`);

    const aliasKey = externalId(corpId, aliasUserId);
    const existing = this.externalToPersonId.get(aliasKey);
    if (existing && existing !== personId) throw new InvalidAccountError(`Alias ${aliasKey} is already linked`);
    this.externalToPersonId.set(aliasKey, personId);
    this.persist();
    return personId;
  }

  aliasesFor(personId) {
    return [...this.externalToPersonId.entries()]
      .filter(([, linkedPersonId]) => linkedPersonId === personId)
      .map(([key]) => key);
  }

  persist() {}
}

export class JsonFileIdentityRegistry extends IdentityRegistry {
  constructor(filePath) {
    let records = {};
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      if (data.version !== 1 || typeof data.externalToPersonId !== 'object') {
        throw new Error('Unsupported identity registry format');
      }
      records = data.externalToPersonId;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    super(records);
    this.filePath = filePath;
  }

  persist() {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      externalToPersonId: Object.fromEntries(this.externalToPersonId),
    }, null, 2);
    writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}

function validateWeComAccount(raw) {
  const corpId = required(raw.corpId, 'corpId');
  const userId = required(raw.userId, 'userId').toLowerCase();
  const name = required(raw.name, 'name');
  const email = required(raw.email, 'email').toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InvalidAccountError('email is invalid');
  }
  if (raw.active !== true) {
    throw new InactiveAccountError(`WeCom account ${userId} is inactive`);
  }
  if (!Array.isArray(raw.allowedApplications) || !raw.allowedApplications.includes('openproject')) {
    throw new UnauthorizedAccountError(`WeCom account ${userId} is not allowed to use OpenProject`);
  }

  return { corpId, userId, name, email };
}

export function normalizeWeComAccount(raw) {
  const personId = required(raw.personId, 'personId');
  const { corpId, userId, name, email } = validateWeComAccount(raw);

  const nameParts = name.split(/\s+/);
  const givenName = nameParts.shift();
  const familyName = nameParts.join(' ') || name;
  const departmentGroups = (raw.departmentNames || [])
    .map((department) => readableSlug(department))
    .filter(Boolean)
    .map((department) => `/departments/${department}`);

  return {
    sub: `wecom-person:${personId}`,
    preferred_username: stableUsername(personId),
    name,
    given_name: givenName,
    family_name: familyName,
    email,
    email_verified: true,
    groups: [...new Set([APP_GROUP, ...departmentGroups])],
    source: { corpId, userId, personId },
  };
}

export class AccountDirectory {
  #byExternalId = new Map();
  #bySubject = new Map();

  constructor(accounts = [], { identityRegistry = new IdentityRegistry() } = {}) {
    this.identityRegistry = identityRegistry;
    for (const account of accounts) this.upsert(account);
  }

  upsert(raw) {
    validateWeComAccount(raw);
    const personId = this.identityRegistry.resolve(raw.corpId, raw.userId, raw.personId);
    const account = normalizeWeComAccount({ ...raw, personId });
    for (const alias of this.identityRegistry.aliasesFor(personId)) this.#byExternalId.set(alias, account);
    this.#bySubject.set(account.sub, account);
    return account;
  }

  linkAlias(corpId, currentUserId, aliasUserId) {
    const personId = this.identityRegistry.linkAlias(corpId, currentUserId, aliasUserId);
    const account = this.#bySubject.get(`wecom-person:${personId}`);
    if (account) this.#byExternalId.set(externalId(corpId, aliasUserId), account);
  }

  findByExternalId(corpId, userId) {
    return this.#byExternalId.get(externalId(corpId, userId));
  }

  findBySubject(subject) {
    return this.#bySubject.get(subject);
  }

  all() {
    return [...this.#bySubject.values()];
  }
}
