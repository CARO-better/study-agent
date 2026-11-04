'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inbox = require('../miniprogram/lib/inbox');

const task = (id, overrides = {}) => ({ id, title: `任务${id}`, status: 'open', dueAt: '2026-11-04', priority: 'medium', ...overrides });

test('digest separates overdue, due today and later while ignoring completed work', () => {
  const digest = inbox.buildDigest([
    task('a', { dueAt: '2026-11-02' }),
    task('b', { dueAt: '2026-11-04' }),
    task('c', { dueAt: '2026-11-09' }),
    task('d', { status: 'completed', dueAt: '2026-11-04' })
  ], { date: '2026-11-04', now: '2026-11-04T00:00:00.000Z' });
  assert.equal(digest.openCount, 3);
  assert.equal(digest.overdueCount, 1);
  assert.equal(digest.dueTodayCount, 1);
  assert.deepEqual(digest.items.map(item => item.taskId), ['a', 'b', 'c']);
  assert.equal(digest.items[0].overdue, true);
  assert.equal(digest.items[1].overdue, false);
});

test('overdue work comes first, then today by priority, then later by date', () => {
  const digest = inbox.buildDigest([
    task('later-late', { dueAt: '2026-11-20' }),
    task('today-low', { dueAt: '2026-11-04', priority: 'low' }),
    task('today-high', { dueAt: '2026-11-04', priority: 'high' }),
    task('overdue-new', { dueAt: '2026-11-03' }),
    task('overdue-old', { dueAt: '2026-11-01' })
  ], { date: '2026-11-04' });
  assert.deepEqual(digest.items.map(item => item.taskId),
    ['overdue-old', 'overdue-new', 'today-high', 'today-low', 'later-late']);
});

test('one message per day: updates in place, keeps read state, ignores unchanged boards', () => {
  const day = { date: '2026-11-04', now: '2026-11-04T08:00:00.000Z' };
  let store = inbox.upsertDigest(inbox.emptyStore(), inbox.buildDigest([task('a')], day));
  store = inbox.markRead(store, '2026-11-04');
  assert.equal(store.messages.length, 1);
  assert.equal(store.lastReadDate, '2026-11-04');

  const unchanged = inbox.upsertDigest(store, inbox.buildDigest([task('a')], day));
  assert.equal(unchanged.messages.length, 1);
  assert.equal(unchanged.lastReadDate, '2026-11-04');

  const changed = inbox.upsertDigest(unchanged, inbox.buildDigest([task('a'), task('b')], day));
  assert.equal(changed.messages.length, 1);
  assert.equal(changed.messages[0].openCount, 2);
  assert.equal(changed.lastReadDate, '2026-11-04', 'update must not clear the read state');
});

test('badge shows open work until the list is opened that day', () => {
  const digest = inbox.buildDigest([task('a'), task('b')], { date: '2026-11-04' });
  let store = inbox.upsertDigest(inbox.emptyStore(), digest);
  assert.equal(inbox.unreadBadge(store, '2026-11-04'), 2);
  store = inbox.markRead(store, '2026-11-04');
  assert.equal(inbox.unreadBadge(store, '2026-11-04'), 0);
  // 第二天还没生成新日报时不应残留旧徽标
  assert.equal(inbox.unreadBadge(store, '2026-11-05'), 0);
});

test('history keeps at most 30 daily messages, newest first', () => {
  let store = inbox.emptyStore();
  const start = Date.parse('2026-09-01T00:00:00Z');
  const dateAt = index => new Date(start + index * 86400000).toISOString().slice(0, 10);
  for (let index = 0; index < 35; index += 1) {
    store = inbox.upsertDigest(store, inbox.buildDigest([task(`t${index}`)], { date: dateAt(index) }));
  }
  assert.equal(store.messages.length, inbox.MAX_MESSAGES);
  assert.equal(store.messages[0].date, dateAt(34));
  assert.ok(store.messages.every((message, index) => index === 0 || message.date < store.messages[index - 1].date));
});

test('summary text reports what the user actually has to do', () => {
  const digest = inbox.buildDigest([
    task('a', { dueAt: '2026-11-01' }),
    task('b', { dueAt: '2026-11-04' }),
    task('c', { dueAt: '2026-12-01' })
  ], { date: '2026-11-04' });
  assert.equal(inbox.summaryText(digest), '未完成 3 · 逾期 1 · 今日截止 1');
  assert.equal(inbox.summaryText(inbox.buildDigest([], { date: '2026-11-04' })), '今天没有未完成任务');
});
