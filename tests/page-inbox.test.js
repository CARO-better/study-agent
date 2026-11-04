'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// 用一个最小的 wx / Page 替身，验证页面真的把消息中心接上了，
// 而不只是 inbox 纯函数能跑。
function loadPage(tasks) {
  const store = {
    study_trial_v1: { courses: [], tasks, availability: [], blocks: [], unscheduled: [], previous: null }
  };
  global.wx = {
    getStorageSync: key => (store[key] === undefined ? '' : store[key]),
    setStorageSync: (key, value) => { store[key] = value; },
    showToast: () => {},
    showModal: () => {}
  };
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/today/index.js');
  delete require.cache[file];
  require(file);
  const page = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  Object.assign(page, definition);
  return { page, store };
}

const base = { status: 'open', priority: 'medium', remainingMinutes: 60, version: 1 };

test('the today page builds one digest, shows a badge and clears it when opened', () => {
  const { page, store } = loadPage([
    { ...base, id: 't1', title: '实验报告', dueAt: '2026-11-01', priority: 'high' },
    { ...base, id: 't2', title: '复习线代', dueAt: '2026-11-09', priority: 'low' }
  ]);
  page.onLoad();
  assert.equal(page.data.unread, 2);
  assert.equal(page.data.inboxMessages.length, 1);
  assert.match(page.data.inboxMessages[0].summary, /未完成 2/);
  assert.match(page.data.inboxMessages[0].summary, /逾期 1/);
  assert.ok(store.study_inbox_v1, 'digest is persisted under its own key');

  page.openInbox();
  assert.equal(page.data.showInbox, true);
  assert.equal(page.data.unread, 0);
  assert.equal(store.study_inbox_v1.lastReadDate, page.data.today);
});

test('ticking a task from the message list updates both the board and the digest', () => {
  const { page, store } = loadPage([
    { ...base, id: 't1', title: '实验报告', dueAt: '2026-11-01' },
    { ...base, id: 't2', title: '复习线代', dueAt: '2026-11-09' }
  ]);
  page.onLoad();
  page.toggleFromInbox({ currentTarget: { dataset: { id: 't1' } } });
  assert.equal(store.study_trial_v1.tasks[0].status, 'completed');
  assert.match(page.data.inboxMessages[0].summary, /未完成 1/);
  assert.equal(store.study_inbox_v1.messages.length, 1, 'a same-day update must not create a second message');
});
