'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../miniprogram/lib/backup');

const trial = {
  courses: [{ id: 'c1', name: '高等数学', semester: '2026 秋' }],
  tasks: [
    { id: 't1', title: '实验报告', status: 'open', dueAt: '2026-11-10' },
    { id: 't2', title: '复习线代', status: 'completed', dueAt: '2026-11-01' }
  ],
  availability: [{ id: 'a1', date: '2026-11-05', startTime: '19:00', endTime: '21:00' }],
  blocks: [], unscheduled: [], previous: null
};

test('a backup restores study data without exporting a plaintext provider key', () => {
  const text = JSON.stringify(backup.buildBackup({
    trial,
    ai: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: 'sk-test' },
    inbox: { messages: [{ date: '2026-11-04', openCount: 2 }], lastReadDate: '2026-11-04' }
  }, '2026-11-04T12:00:00.000Z'));
  const parsed = backup.parseBackup(text);
  assert.equal(parsed.trial.tasks.length, 2);
  assert.equal(parsed.trial.courses[0].name, '高等数学');
  assert.equal(parsed.ai.apiKey, '');
  assert.equal(parsed.inbox.messages.length, 1);
  assert.deepEqual(backup.counts(parsed), { courses: 1, tasks: 2, done: 1, availability: 1, hasKey: false });
});

test('broken or foreign payloads are rejected with a readable reason', () => {
  assert.throws(() => backup.parseBackup(''), error => error.code === 'BACKUP_INVALID');
  assert.throws(() => backup.parseBackup('{"format":"other"}'), error => /不是本小程序/.test(error.message));
  assert.throws(() => backup.parseBackup('{"format":"study-agent/local-backup/v1"}'), error => /没有任务数据/.test(error.message));
  assert.throws(() => backup.parseBackup('{"format":'), error => /不是有效的 JSON/.test(error.message));
});

test('missing optional sections fall back to empty instead of crashing the page', () => {
  const parsed = backup.parseBackup(JSON.stringify({ format: backup.FORMAT, trial: { tasks: [] } }));
  assert.deepEqual(parsed.trial.courses, []);
  assert.deepEqual(parsed.inbox.messages, []);
  assert.equal(parsed.ai, null);
  assert.equal(backup.counts(parsed).hasKey, false);
});

test('the restore prompt states what will be overwritten', () => {
  const parsed = backup.parseBackup(JSON.stringify(backup.buildBackup({ trial, ai: null, inbox: null })));
  const text = backup.describe(parsed);
  assert.match(text, /课程 1 门/);
  assert.match(text, /任务 2 条/);
  assert.match(text, /已完成 1/);
  assert.equal(text.includes('API Key'), false);
});
