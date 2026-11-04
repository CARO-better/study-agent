'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const towxml = require('../miniprogram/towxml/index');

const root = path.resolve(__dirname, '..', 'miniprogram', 'towxml');

test('the vendored build parses the markdown the assistant actually writes', () => {
  const tree = towxml('# 今日安排\n\n- **高数**：交作业\n- 英语：背单词\n\n| 任务 | 时间 |\n| --- | --- |\n| 作业 | 20:00 |', 'markdown');
  const text = JSON.stringify(tree);
  assert.ok(text.includes('"tag":"h1"'), 'heading');
  assert.ok(text.includes('"tag":"strong"'), 'bold');
  assert.ok(text.includes('"tag":"table"'), 'table');
  assert.ok(text.includes('今日安排'));
});

test('an unsupported type fails loudly instead of returning an empty tree', () => {
  assert.throws(() => towxml('x', 'pdf'));
});

test('component metadata keeps the absolute paths the build produced', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'towxml.json'), 'utf8'));
  assert.equal(meta.component, true);
  const decode = JSON.parse(fs.readFileSync(path.join(root, 'decode.json'), 'utf8'));
  assert.equal(decode.usingComponents.table, '/towxml/table/table');
  assert.equal(decode.usingComponents.img, '/towxml/img/img');
  assert.ok(fs.existsSync(path.join(root, 'index.js')));
  assert.ok(fs.existsSync(path.join(root, 'NOTICE.md')), 'MIT attribution must ship with the vendored code');
});

test('charts, formulas and code highlighting stay out of this build', () => {
  assert.equal(fs.existsSync(path.join(root, 'echarts')), false);
  assert.equal(fs.existsSync(path.join(root, 'latex')), false);
  assert.equal(fs.existsSync(path.join(root, 'yuml')), false);
  assert.equal(fs.existsSync(path.join(root, 'parse', 'highlight', 'languages')), false);
});
