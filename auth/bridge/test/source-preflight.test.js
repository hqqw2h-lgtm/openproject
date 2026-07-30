import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(bridgeRoot, '..', '..');
const preflight = path.join(
  workspaceRoot,
  'docker',
  'prod',
  'setup',
  'validate-source-tree.sh',
);
const requiredLocales = path.join(
  workspaceRoot,
  'docker',
  'prod',
  'setup',
  'required-module-locales.txt',
);

test('required locale manifest matches tracked English and Simplified Chinese catalogs', async () => {
  const pathspecs = [
    'config/locales/en.yml',
    'config/locales/js-en.yml',
    'config/locales/crowdin/zh-CN.yml',
    'config/locales/crowdin/js-zh-CN.yml',
    'config/locales/crowdin/zh-CN.seeders.yml',
    'modules/*/config/locales/en.yml',
    'modules/*/config/locales/js-en.yml',
    'modules/*/config/locales/crowdin/zh-CN.yml',
    'modules/*/config/locales/crowdin/js-zh-CN.yml',
    'modules/*/config/locales/crowdin/zh-CN.seeders.yml',
  ];
  const [{ stdout }, manifest] = await Promise.all([
    execFileAsync('git', ['ls-files', ...pathspecs], { cwd: workspaceRoot }),
    readFile(requiredLocales, 'utf8'),
  ]);
  const tracked = stdout.trim().split('\n').filter(Boolean).sort();
  const required = manifest.trim().split('\n').filter(Boolean).sort();

  assert.deepEqual(required, tracked);
});

test('source preflight rejects missing tracked module locales and then passes when complete', async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'openproject-source-preflight-'));
  const localeManifest = path.join(sourceRoot, 'tracked-locales.txt');
  const environment = {
    ...process.env,
    LOCALE_MANIFEST: localeManifest,
    SOURCE_ROOT: sourceRoot,
  };

  try {
    await mkdir(path.join(sourceRoot, 'config', 'locales'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'config', 'locales', 'en.yml'), 'en:\n');
    await writeFile(
      localeManifest,
      [
        'config/locales/en.yml',
        'modules/documents/config/locales/en.yml',
      ].join('\n'),
    );

    await assert.rejects(
      execFileAsync('bash', [preflight], { env: environment }),
      (error) => {
        assert.match(`${error.stdout}\n${error.stderr}`, /modules\/documents\/config\/locales\/en\.yml/);
        assert.match(`${error.stdout}\n${error.stderr}`, /git sparse-checkout add/);
        return true;
      },
    );

    await mkdir(path.join(sourceRoot, 'modules', 'documents', 'config', 'locales'), { recursive: true });
    await writeFile(
      path.join(sourceRoot, 'modules', 'documents', 'config', 'locales', 'en.yml'),
      'en:\n',
    );

    const { stdout } = await execFileAsync('bash', [preflight], { env: environment });
    assert.match(stdout, /Source locale preflight passed \(2 files\)/);
  } finally {
    await rm(sourceRoot, { force: true, recursive: true });
  }
});
