'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { checkConfig } = require('../scripts/check-config');

// Catches false positive readiness when required public project identity is absent.
test('empty configuration reports missing environment and mini program identity', () => {
  assert.deepEqual(checkConfig({}), { ready: false, missing: ['envId', 'appId'] });
});

// Catches accidental dependence on secret credentials for a local metadata check.
test('valid public identity passes the local configuration check without credentials', () => {
  assert.deepEqual(checkConfig({ envId: 'study-dev-123', appId: 'wx1234567890abcdef' }), {
    ready: true, missing: []
  });
});

test('blank values and tourist app identity do not qualify as configured', () => {
  assert.deepEqual(checkConfig({ envId: '  ', appId: 'touristappid' }), {
    ready: false, missing: ['envId', 'appId']
  });
});

test('invalid input and malformed public identity remain unconfigured', () => {
  for (const input of [null, undefined, [], 'config', { envId: 42, appId: true },
    { envId: 'replace-with-env-id', appId: 'wx-not-valid' }]) {
    assert.equal(checkConfig(input).ready, false);
  }
});

// Catches configuration/credential echo in both return values and CLI output.
test('local check never includes supplied secrets in its result', () => {
  const key = 'test-only-key-must-never-appear';
  const result = checkConfig({ envId: 'study-dev-123', appId: 'wx1234567890abcdef', apiKey: key,
    ocr: { secretKey: key } });
  assert.deepEqual(result, { ready: true, missing: [] });
  assert.equal(JSON.stringify(result).includes(key), false);
});

function runConfigFile(content) {
  const directory = mkdtempSync(path.join(tmpdir(), 'study-config-'));
  try {
    const filename = path.join(directory, 'config.json');
    writeFileSync(filename, content);
    return spawnSync(process.execPath, [path.resolve('scripts/check-config.js'), filename], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('CLI prints only a safe local readiness result and returns exit status', () => {
  const key = 'test-only-cli-secret';
  const valid = runConfigFile(JSON.stringify({ envId: 'study-dev-123', appId: 'wx1234567890abcdef', key }));
  assert.equal(valid.status, 0);
  assert.deepEqual(JSON.parse(valid.stdout), { ready: true, missing: [] });
  assert.equal((valid.stdout + valid.stderr).includes(key), false);
  const empty = runConfigFile('{}');
  assert.equal(empty.status, 1);
  assert.deepEqual(JSON.parse(empty.stdout), { ready: false, missing: ['envId', 'appId'] });
});

test('CLI suppresses file parse content and credentials on malformed input', () => {
  const bad = runConfigFile('{"secret":"test-only-malformed-secret"');
  assert.equal(bad.status, 1);
  assert.deepEqual(JSON.parse(bad.stdout), { ready: false, missing: ['configFile'] });
  assert.equal((bad.stdout + bad.stderr).includes('test-only-malformed-secret'), false);
});

// Exercises the import boundary: all configured page routes need files, no real AppID committed.
test('mini program entry and registered pages are present for developer tool import', () => {
  const root = path.resolve(__dirname, '..');
  const project = JSON.parse(readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.equal(project.compileType, 'miniprogram');
  assert.equal(project.appid, 'touristappid');
  const mini = path.join(root, project.miniprogramRoot);
  const app = JSON.parse(readFileSync(path.join(mini, 'app.json'), 'utf8'));
  assert.ok(app.pages.length > 0);
  assert.ok(existsSync(path.join(mini, 'app.js')));
  for (const page of app.pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(existsSync(path.join(mini, page + '.' + extension)), page + '.' + extension);
    }
  }
  assert.ok(existsSync(path.join(root, project.cloudfunctionRoot)));
});
