'use strict';
// 本地消息中心的纯逻辑：把当天未完成任务汇总成一条日报。
// 不依赖 wx API，方便用 node 直接测试；页面只负责读写存储和渲染。

const MAX_MESSAGES = 30;
const MAX_ITEMS = 20;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function localDate(value) {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isOpen(task) {
  return task && task.status !== 'completed';
}

function urgency(task, date) {
  const overdue = Boolean(task.dueAt && task.dueAt < date);
  return [overdue ? 0 : task.dueAt === date ? 1 : 2, PRIORITY_ORDER[task.priority] ?? 1, task.dueAt || '9999-12-31', task.title || ''];
}

function compare(a, b) {
  const left = urgency(a, a.__date);
  const right = urgency(b, b.__date);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function signature(tasks, date) {
  return tasks.filter(isOpen).map(task => `${task.id}:${task.status}:${task.dueAt || ''}:${task.priority || ''}`).sort().join('|');
}

// One digest per calendar day. It always reflects the current board, so the
// message list cannot show a stale "unfinished" list after the user ticks a task.
function buildDigest(tasks, { date = localDate(), now = new Date().toISOString() } = {}) {
  const open = (tasks || []).filter(isOpen);
  const overdue = open.filter(task => task.dueAt && task.dueAt < date);
  const dueToday = open.filter(task => task.dueAt === date);
  const later = open.filter(task => !task.dueAt || task.dueAt > date);
  const ordered = [...overdue, ...dueToday, ...later]
    .map(task => ({ ...task, __date: date }))
    .sort(compare)
    .slice(0, MAX_ITEMS)
    .map(task => ({
      taskId: task.id,
      title: task.title || '未命名任务',
      dueAt: task.dueAt || null,
      priority: task.priority || 'medium',
      overdue: Boolean(task.dueAt && task.dueAt < date)
    }));
  return {
    id: `digest-${date}`,
    date,
    createdAt: now,
    openCount: open.length,
    overdueCount: overdue.length,
    dueTodayCount: dueToday.length,
    items: ordered,
    signature: signature(tasks, date)
  };
}

function emptyStore() {
  return { messages: [], lastReadDate: null };
}

// Replaces today's digest in place. Read state survives an update, and an
// unchanged board does not produce a new message.
function upsertDigest(store, digest) {
  const base = store && Array.isArray(store.messages) ? store : emptyStore();
  const existing = base.messages.find(message => message.date === digest.date);
  if (existing && existing.signature === digest.signature) {
    return { ...base, messages: base.messages.map(message => (message.date === digest.date ? { ...message, openCount: digest.openCount, overdueCount: digest.overdueCount, dueTodayCount: digest.dueTodayCount, items: digest.items } : message)) };
  }
  const messages = [digest, ...base.messages.filter(message => message.date !== digest.date)]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, MAX_MESSAGES);
  return { ...base, messages };
}

// The badge shows how many tasks are still open today, and only until the user
// opens the message list on that day.
function unreadBadge(store, date = localDate()) {
  if (!store || store.lastReadDate === date) return 0;
  const today = (store.messages || []).find(message => message.date === date);
  return today ? today.openCount : 0;
}

function markRead(store, date = localDate()) {
  const base = store && Array.isArray(store.messages) ? store : emptyStore();
  return { ...base, lastReadDate: date };
}

function summaryText(digest) {
  if (!digest) return '';
  if (!digest.openCount) return '今天没有未完成任务';
  const parts = [`未完成 ${digest.openCount}`];
  if (digest.overdueCount) parts.push(`逾期 ${digest.overdueCount}`);
  if (digest.dueTodayCount) parts.push(`今日截止 ${digest.dueTodayCount}`);
  return parts.join(' · ');
}

module.exports = { localDate, buildDigest, upsertDigest, unreadBadge, markRead, summaryText, emptyStore, MAX_MESSAGES };
