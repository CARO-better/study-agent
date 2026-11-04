'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../miniprogram/lib/tools');
const ai = require('../miniprogram/lib/ai');

const emptyStore = () => ({
  courses: [{ id: 'c1', name: '高等数学', semester: '2026 秋' }],
  tasks: [{ id: 't1', title: '实验报告', status: 'open', dueAt: '2026-11-10', priority: 'medium', remainingMinutes: 60, version: 1 }],
  availability: [], blocks: [], unscheduled: [], previous: null
});
const context = (seed = 1) => ({ now: '2026-11-04T12:00:00.000Z', date: '2026-11-04', id: (() => { let n = seed; return () => `new${n++}`; })() });

test('create_task links an existing course and never invents a deadline', () => {
  const outcome = tools.executeTool(emptyStore(), 'create_task', { title: '交线代作业', courseName: '高等数学', remainingMinutes: 45 }, context());
  assert.equal(outcome.result.ok, true);
  const created = outcome.store.tasks.find(task => task.title === '交线代作业');
  assert.equal(created.courseId, 'c1');
  assert.equal(created.dueAt, '');
  assert.equal(created.remainingMinutes, 45);
  assert.equal(created.type, 'homework');
  assert.equal(outcome.store.tasks.length, 2);
  assert.equal(emptyStore().tasks.length, 1, 'input store must not be mutated');
});

test('create_task refuses duplicates instead of stacking the same todo', () => {
  const store = emptyStore();
  const first = tools.executeTool(store, 'create_task', { title: '实验报告' }, context());
  assert.equal(first.result.ok, false);
  assert.match(first.result.reason, /已有同名/);
  assert.equal(first.store.tasks.length, 1);
});

test('update_task_status finds the task by partial title and keeps others intact', () => {
  const outcome = tools.executeTool(emptyStore(), 'update_task_status', { title: '实验', status: 'completed' }, context());
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.store.tasks[0].status, 'completed');
  assert.equal(outcome.store.tasks[0].version, 2);
});

test('list_tasks reports overdue work with the current date', () => {
  const store = { ...emptyStore(), tasks: [
    { id: 'a', title: '过期作业', status: 'open', dueAt: '2026-11-01' },
    { id: 'b', title: '今天作业', status: 'open', dueAt: '2026-11-04' },
    { id: 'c', title: '已完成', status: 'completed', dueAt: '2026-11-02' }
  ] };
  const outcome = tools.executeTool(store, 'list_tasks', { scope: 'overdue' }, context());
  assert.equal(outcome.result.count, 1);
  assert.equal(outcome.result.tasks[0].title, '过期作业');
  assert.equal(outcome.result.tasks[0].overdue, true);
});

test('the agent loop executes tool calls and feeds results back to the model', async () => {
  const store = emptyStore();
  let current = store;
  const seen = [];
  const request = async (messages) => {
    seen.push(messages);
    if (messages.some(message => message.role === 'tool')) {
      return { choices: [{ message: { content: '已经把线代作业加进去了，截止日期截图里没写，麻烦你补一下。' } }] };
    }
    return {
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call-1', function: { name: 'create_task', arguments: '{"title":"线代作业","courseName":"高等数学"}' } }]
        }
      }]
    };
  };
  const result = await ai.runAgent({
    messages: [{ role: 'user', content: '帮我加个线代作业' }],
    request,
    execute: async (name, args) => { const outcome = tools.executeTool(current, name, args, context()); current = outcome.store; return outcome; }
  });
  assert.match(result.reply, /截止日期/);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].result.ok, true);
  assert.equal(current.tasks.some(task => task.title === '线代作业'), true);
  assert.equal(seen.length, 2, 'one round for the tool call, one for the answer');
  assert.ok(seen[1].some(message => message.role === 'tool'), 'tool result must be sent back');
});

test('a malformed model payload fails loudly instead of pretending success', async () => {
  await assert.rejects(ai.runAgent({ messages: [], request: async () => ({ ok: true }), execute: async () => ({}) }),
    error => error.code === 'MODEL_BAD_RESPONSE');
});

test('system prompt carries the date and forbids guessing deadlines', () => {
  const prompt = ai.systemPrompt({ date: '2026-11-04', courses: [{ name: '高等数学' }], tasks: [{ status: 'open' }] });
  assert.match(prompt, /2026-11-04/);
  assert.match(prompt, /高等数学/);
  assert.match(prompt, /不要猜/);
});

test('deleting a task needs an explicit confirmation and never removes it by itself', () => {
  const store = emptyStore();
  const single = tools.executeTool(store, 'delete_task', { title: '实验报告' }, context());
  assert.equal(single.result.ok, false);
  assert.equal(single.result.needsConfirmation, true);
  assert.equal(single.store.tasks.length, 1, 'the tool must not delete anything');
  assert.equal(single.result.task.title, '实验报告');
});

test('ambiguous names come back as candidates instead of picking one', () => {
  const store = { ...emptyStore(), tasks: [
    { id: 'a', title: '实验报告', status: 'open' },
    { id: 'b', title: '实验报告二', status: 'open' }
  ] };
  // 「实验」没有完全同名项，才会落到模糊匹配并出现多个候选
  const outcome = tools.executeTool(store, 'delete_task', { title: '实验' }, context());
  assert.equal(outcome.result.ambiguous, true);
  assert.equal(outcome.store.tasks.length, 2);
  assert.deepEqual(outcome.result.candidates.map(item => item.title), ['实验报告', '实验报告二']);
  // 完全同名时不再歧义，直接进入待确认
  const exact = tools.executeTool(store, 'delete_task', { title: '实验报告' }, context());
  assert.equal(exact.result.needsConfirmation, true);
});

test('removeTask drops the task together with its plan blocks and unscheduled rows', () => {
  const store = {
    ...emptyStore(),
    blocks: [{ taskId: 't1', start: 'x', end: 'y' }, { taskId: 'other', start: 'x', end: 'y' }],
    unscheduled: [{ taskId: 't1', reason: 'no_availability' }]
  };
  const result = tools.removeTask(store, 't1');
  assert.equal(result.result.ok, true);
  assert.deepEqual(result.store.tasks.map(task => task.id), []);
  assert.deepEqual(result.store.blocks.map(block => block.taskId), ['other']);
  assert.equal(result.store.unscheduled.length, 0);
});

test('records are described in Chinese for the chat transcript', () => {
  const lines = ai.describeRecords([
    { name: 'create_task', result: { ok: true, task: { title: '线代作业' } } },
    { name: 'create_task', result: { ok: false, reason: '已有同名未完成任务「实验报告」' } },
    { name: 'update_task_status', result: { ok: true, title: '实验报告', status: 'completed' } }
  ]);
  assert.equal(lines[0], '已添加任务「线代作业」');
  assert.match(lines[1], /没添加/);
  assert.match(lines[2], /标记为完成/);
});
