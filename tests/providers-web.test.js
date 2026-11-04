'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../miniprogram/lib/providers');

test('every preset is a usable OpenAI-compatible endpoint', () => {
  assert.ok(providers.PRESETS.length >= 3);
  const ids = new Set();
  for (const preset of providers.PRESETS) {
    assert.equal(ids.has(preset.id), false, `duplicate id ${preset.id}`);
    ids.add(preset.id);
    assert.match(preset.url, /^https:\/\/.+\/chat\/completions$/);
    assert.ok(preset.model.trim().length > 0);
    assert.equal(typeof preset.vision, 'boolean');
    assert.ok(preset.note.length > 0);
  }
});

test('applying a preset swaps address and model but keeps the key', () => {
  const next = providers.applyPreset({ url: 'https://old', model: 'old', apiKey: 'sk-secret' }, 'kimi');
  assert.equal(next.url, 'https://api.moonshot.cn/v1/chat/completions');
  assert.equal(next.model, 'kimi-k2.6');
  assert.equal(next.apiKey, 'sk-secret');
  assert.equal(next.presetId, 'kimi');
});

test('an unknown id is treated as custom without wiping what the user typed', () => {
  const next = providers.applyPreset({ url: 'https://mine/v1/chat/completions', model: 'my-model', apiKey: 'k' }, 'custom');
  assert.equal(next.presetId, 'custom');
  assert.equal(next.url, 'https://mine/v1/chat/completions');
  assert.equal(next.model, 'my-model');
});

test('the current preset is recognised from a saved url, and custom urls stay custom', () => {
  assert.equal(providers.matchPreset({ url: ' https://api.deepseek.com/chat/completions ' }).id, 'deepseek');
  assert.equal(providers.matchPreset({ url: 'https://api.xiaomimimo.com/v1/chat/completions' }).id, 'mimo');
  assert.equal(providers.matchPreset({ url: 'https://example.com/v1/chat/completions' }), null);
  assert.equal(providers.matchPreset({}), null);
});
