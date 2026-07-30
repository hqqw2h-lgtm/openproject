import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AccountDirectory,
  IdentityRegistry,
  InactiveAccountError,
  InvalidAccountError,
  JsonFileIdentityRegistry,
  UnauthorizedAccountError,
  normalizeWeComAccount,
} from '../src/accounts.js';

function rawAccount(overrides = {}) {
  return {
    personId: 'person-alice',
    corpId: 'ww-amperun',
    userId: 'Alice.Zhang',
    name: 'Alice Zhang',
    email: 'alice@example.com',
    departmentNames: ['Engineering', 'Platform'],
    allowedApplications: ['openproject'],
    active: true,
    ...overrides,
  };
}

test('normalizes a WeCom identity into stable OIDC claims', () => {
  const account = normalizeWeComAccount(rawAccount());

  assert.equal(account.sub, 'wecom-person:person-alice');
  assert.match(account.preferred_username, /^wecom-[a-f0-9]{16}$/);
  assert.equal(account.email_verified, true);
  assert.deepEqual(account.groups, [
    '/apps/openproject/users',
    '/departments/engineering',
    '/departments/platform',
  ]);
});

test('uses corp id as part of the subject and treats user ids case-insensitively', () => {
  const first = normalizeWeComAccount(rawAccount({ corpId: 'ww-one', userId: 'Alice' }));
  const samePerson = normalizeWeComAccount(rawAccount({ corpId: 'ww-one', userId: 'ALICE' }));
  const otherCorp = normalizeWeComAccount(rawAccount({
    personId: 'person-alice-other-corp',
    corpId: 'ww-two',
    userId: 'Alice',
    email: 'alice@two.example',
  }));

  assert.equal(first.sub, samePerson.sub);
  assert.notEqual(first.sub, otherCorp.sub);
  assert.notEqual(first.preferred_username, otherCorp.preferred_username);
});

test('rejects missing corporate email and inactive identities', () => {
  assert.throws(
    () => normalizeWeComAccount(rawAccount({ email: undefined })),
    InvalidAccountError,
  );
  assert.throws(
    () => normalizeWeComAccount(rawAccount({ active: false })),
    InactiveAccountError,
  );
  assert.throws(
    () => normalizeWeComAccount(rawAccount({ allowedApplications: [] })),
    UnauthorizedAccountError,
  );
});

test('does not persist identity mappings for rejected accounts', () => {
  const identityRegistry = new IdentityRegistry();
  const directory = new AccountDirectory([], { identityRegistry });

  assert.throws(
    () => directory.upsert(rawAccount({ allowedApplications: [] })),
    UnauthorizedAccountError,
  );
  assert.equal(identityRegistry.externalToPersonId.size, 0);
});

test('directory resolves accounts by immutable subject', () => {
  const directory = new AccountDirectory([rawAccount({ corpId: 'ww-one', userId: 'alice' })]);

  const account = directory.findByExternalId('ww-one', 'ALICE');
  assert.equal(directory.findBySubject(account.sub).email, 'alice@example.com');
});

test('directory preserves person subject when a UserID alias is linked', () => {
  const directory = new AccountDirectory([rawAccount({ corpId: 'ww-one', userId: 'alice' })]);
  const before = directory.findByExternalId('ww-one', 'alice');

  directory.linkAlias('ww-one', 'alice', 'alice.new');
  const after = directory.upsert(rawAccount({
    personId: undefined,
    corpId: 'ww-one',
    userId: 'alice.new',
    name: 'Alice Renamed',
  }));

  assert.equal(after.sub, before.sub);
  assert.equal(after.preferred_username, before.preferred_username);
  assert.equal(directory.findByExternalId('ww-one', 'alice').name, 'Alice Renamed');
});

test('preferred usernames do not collide after normalization', () => {
  const first = normalizeWeComAccount(rawAccount({ userId: 'alice@corp' }));
  const second = normalizeWeComAccount(rawAccount({ personId: 'person-two', userId: 'alice-corp' }));

  assert.notEqual(first.preferred_username, second.preferred_username);
});

test('rejects malformed account fields and identity remapping attempts', () => {
  assert.throws(
    () => normalizeWeComAccount(rawAccount({ email: 'not-an-email' })),
    /email is invalid/,
  );

  const registry = new IdentityRegistry({ 'ww-one:alice': 'person-one' });
  assert.throws(
    () => registry.resolve('ww-one', 'alice', 'person-two'),
    /already linked/,
  );
  assert.throws(
    () => registry.linkAlias('ww-one', 'missing', 'alias'),
    /Unknown external identity/,
  );

  registry.resolve('ww-one', 'bob', 'person-two');
  assert.throws(
    () => registry.linkAlias('ww-one', 'alice', 'bob'),
    /Alias .* is already linked/,
  );
});

test('persists and reloads stable identity mappings atomically', (t) => {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'amperun-identities-'));
  const registryPath = path.join(directoryPath, 'nested', 'registry.json');
  t.after(() => rmSync(directoryPath, { recursive: true, force: true }));

  const registry = new JsonFileIdentityRegistry(registryPath);
  const personId = registry.resolve('ww-one', 'Alice', 'person-one');
  registry.linkAlias('ww-one', 'alice', 'alice.new');

  assert.equal(personId, 'person-one');
  assert.deepEqual(JSON.parse(readFileSync(registryPath, 'utf8')), {
    version: 1,
    externalToPersonId: {
      'ww-one:alice': 'person-one',
      'ww-one:alice.new': 'person-one',
    },
  });

  const reloaded = new JsonFileIdentityRegistry(registryPath);
  assert.equal(reloaded.resolve('ww-one', 'ALICE'), 'person-one');
  assert.deepEqual(reloaded.aliasesFor('person-one').sort(), [
    'ww-one:alice',
    'ww-one:alice.new',
  ]);
});

test('rejects unsupported identity registry data', (t) => {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'amperun-identities-'));
  const registryPath = path.join(directoryPath, 'registry.json');
  t.after(() => rmSync(directoryPath, { recursive: true, force: true }));

  writeFileSync(registryPath, JSON.stringify({ version: 2, externalToPersonId: {} }));
  assert.throws(() => new JsonFileIdentityRegistry(registryPath), /Unsupported identity registry format/);

  writeFileSync(registryPath, '{invalid-json');
  assert.throws(() => new JsonFileIdentityRegistry(registryPath), SyntaxError);
});

test('normalizes single names and department slugs without duplicate groups', () => {
  const account = normalizeWeComAccount(rawAccount({
    name: 'Alice',
    departmentNames: ['Engineering Team', 'Engineering Team', '!!!'],
  }));

  assert.equal(account.family_name, 'Alice');
  assert.deepEqual(account.groups, [
    '/apps/openproject/users',
    '/departments/engineering-team',
    '/departments/wecom',
  ]);
});
