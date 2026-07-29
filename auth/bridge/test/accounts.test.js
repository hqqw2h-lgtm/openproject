import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountDirectory,
  IdentityRegistry,
  InactiveAccountError,
  InvalidAccountError,
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
