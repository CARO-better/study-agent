'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../cloudfunctions/api');
const { createMemoryRepository } = require('../cloudfunctions/api/adapters/repository');
function setup() {
  let seq = 0;
  const deps = { now: () => '2026-11-04T02:00:00.000Z', newId: () => `r${++seq}` };
  const repository = createMemoryRepository({ now: () => deps.now() }); deps.repository = repository;
  const call = (action, payload = {}, owner = 'alice') => api.handleAction({ owner, action, payload }, deps);
  return { repository, deps, call };
}
async function success(promise) { const result = await promise; assert.equal(result.ok, true, JSON.stringify(result)); return result.data; }
async function error(promise, code) { const result = await promise; assert.equal(result.ok, false); assert.equal(result.error.code, code); }
const task = (extra = {}) => ({ title: '离散数学作业', type: 'assignment', status: 'pending', remainingMinutes: 60, ...extra });
test('owner isolation rejects reading and updating another user record; metadata is server owned', async () => {
  const { call } = setup();
  const created = await success(call('tasks.create', { record: task({ ownerOpenId: 'bob', version: 999 }) }));
  assert.equal(created.ownerOpenId, 'alice'); assert.equal(created.version, 1);
  assert.equal(created.createdAt, '2026-11-04T02:00:00.000Z');
  await error(call('tasks.get', { id: created.id }, 'bob'), 'NOT_FOUND');
  await error(call('tasks.update', { id: created.id, expectedVersion: 1, patch: { title: 'stolen' } }, 'bob'), 'NOT_FOUND');
  assert.equal((await success(call('tasks.get', { id: created.id }))).title, '离散数学作业');
});
test('stale concurrent edits return CONFLICT and retain the winning update', async () => {
  const { call } = setup(); const created = await success(call('tasks.create', { record: task() }));
  const results = await Promise.all(['A', 'B'].map(title => call('tasks.update', { id: created.id, expectedVersion: 1, patch: { title } })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok).error.code, 'CONFLICT');
  assert.equal((await success(call('tasks.get', { id: created.id }))).version, 2);
});
test('draft stays outside tasks until reviewed; missing deadlines remain null and require confirmation', async () => {
  const { call } = setup(); const draft = await success(call('imports.create', { source: 'text', text: '离散数学作业', candidates: [task()] }));
  assert.equal((await success(call('tasks.list'))).length, 0);
  assert.equal(draft.candidates[0].dueAt, null); assert.ok(draft.candidates[0].needsConfirmation.includes('dueAt'));
  await error(call('imports.confirm', { id: draft.id, expectedVersion: 1 }), 'CONFIRMATION_REQUIRED');
  const confirmed = await success(call('imports.confirm', { id: draft.id, expectedVersion: 1, reviewed: true, choices: [{ index: 0, choice: 'save', acknowledge: ['dueAt'] }] }));
  assert.equal(confirmed.tasks.length, 1); assert.equal(confirmed.tasks[0].dueAt, null);
  assert.equal((await success(call('tasks.list'))).length, 1);
  await error(call('imports.confirm', { id: draft.id, expectedVersion: 1, reviewed: true, choices: [] }), 'CONFLICT');
});
test('relative Friday uses explicit China calendar base and missing bases or teaching weeks remain unresolved', async () => {
  const { call } = setup();
  const resolved = await success(call('imports.create', { source: 'text', text: '下周五', referenceDate: '2026-11-04', candidates: [task({ dueText: '下周五' })] }));
  assert.equal(resolved.candidates[0].dueAt, '2026-11-13');
  const unresolved = await success(call('imports.create', { source: 'screenshot', text: '', candidates: [task({ dueText: '下周五', schedule: { periods: [1, 2], weekday: 5 } })] }));
  assert.equal(unresolved.candidates[0].dueAt, null);
  assert.ok(unresolved.candidates[0].needsConfirmation.includes('referenceDate'));
  assert.ok(unresolved.candidates[0].needsConfirmation.includes('schedule.weeks'));
});
test('domain CRUD preserves group/exam/schedule data and validates references and states', async () => {
  const { call } = setup();
  const profile = await success(call('profiles.create', { record: { displayName: '小明', timezone: 'Asia/Shanghai' } }));
  const semester = await success(call('semesters.create', { record: { name: '2026秋', startDate: '2026-09-01', endDate: '2027-01-20', teachingWeeks: 20 } }));
  const course = await success(call('courses.create', { record: { name: '离散数学', semesterId: semester.id, schedule: [{ weekday: 5, weeks: [1, 3, 5], periods: [1, 2], location: '教1' }] } }));
  const parent = await success(call('tasks.create', { record: task({ courseId: course.id, type: 'group', personalResponsibility: '证明部分', examScope: ['图论'] }) }));
  const child = await success(call('tasks.create', { record: task({ parentTaskId: parent.id, courseId: course.id }) }));
  assert.equal(child.parentTaskId, parent.id); assert.equal(parent.personalResponsibility, '证明部分');
  await error(call('tasks.create', { record: task({ parentTaskId: parent.id }) }, 'bob'), 'INVALID_REFERENCE');
  await error(call('tasks.update', { id: parent.id, expectedVersion: 1, patch: { parentTaskId: child.id } }), 'INVALID_REFERENCE');
  await error(call('tasks.create', { record: task({ status: 'unknown' }) }), 'VALIDATION');
  await error(call('tasks.create', { record: task({ remainingMinutes: -1 }) }), 'VALIDATION');
  await error(call('courses.update', { id: course.id, expectedVersion: 1, patch: { schedule: [{ weekday: 9, weeks: [], periods: [0] }] } }), 'VALIDATION');
  await error(call('semesters.delete', { id: semester.id, expectedVersion: 1, confirmed: true }), 'HAS_DEPENDENTS');
  await success(call('tasks.delete', { id: child.id, expectedVersion: 1, confirmed: true }));
  const done = await success(call('tasks.update', { id: parent.id, expectedVersion: 1, patch: { status: 'completed' } })); assert.equal(done.status, 'completed');
  await error(call('profiles.delete', { id: profile.id, expectedVersion: 1 }), 'CONFIRMATION_REQUIRED');
});
test('duplicate confirmation requires explicit save or merge and merge checks target version atomically', async () => {
  const { call } = setup(); const original = await success(call('tasks.create', { record: task({ dueAt: '2026-11-13' }) }));
  const draft = await success(call('imports.create', { source: 'text', text: '离散数学作业', candidates: [task({ dueAt: '2026-11-13', remainingMinutes: 40 })] }));
  assert.deepEqual(draft.candidates[0].duplicateIds, [original.id]);
  await error(call('imports.confirm', { id: draft.id, expectedVersion: 1, reviewed: true, choices: [] }), 'DUPLICATE_CHOICE_REQUIRED');
  await error(call('imports.confirm', { id: draft.id, expectedVersion: 1, reviewed: true, choices: [{ index: 0, choice: 'merge', targetId: original.id, expectedVersion: 0 }] }), 'CONFLICT');
  assert.equal((await success(call('imports.get', { id: draft.id }))).status, 'draft');
  const result = await success(call('imports.confirm', { id: draft.id, expectedVersion: 1, reviewed: true, choices: [{ index: 0, choice: 'merge', targetId: original.id, expectedVersion: 1 }] }));
  assert.equal(result.tasks[0].id, original.id); assert.equal(result.tasks[0].remainingMinutes, 40); assert.equal(result.tasks[0].version, 2);
  const separate = await success(call('imports.create', { source: 'text', text: 'same', candidates: [task({ dueAt: '2026-11-13' })] }));
  await success(call('imports.confirm', { id: separate.id, expectedVersion: 1, reviewed: true, choices: [{ index: 0, choice: 'save' }] }));
  assert.equal((await success(call('tasks.list'))).length, 2);
});
test('expired drafts are marked for cleanup and cannot be confirmed', async () => {
  const { call, deps } = setup(); const draft = await success(call('imports.create', { source: 'screenshot', text: '识别文字', candidates: [task()] }));
  assert.equal(draft.cleanupAfter, '2026-11-05T02:00:00.000Z');
  deps.now = () => '2026-11-05T02:00:00.000Z';
  await error(call('imports.confirm', { id: draft.id, expectedVersion: 1, reviewed: true, choices: [{ index: 0, choice: 'save', acknowledge: ['dueAt'] }] }), 'DRAFT_EXPIRED');
  const marked = await success(call('imports.markExpired'));
  assert.equal(marked.count, 1); assert.equal((await success(call('imports.get', { id: draft.id }))).status, 'expired');
});
test('JSON export excludes other users and scoped deletion requires confirmation plus exact versions', async () => {
  const { call } = setup(); const a = await success(call('tasks.create', { record: task() })); await success(call('tasks.create', { record: task({ title: 'bob secret' }) }, 'bob'));
  const exported = await success(call('data.export')); const parsed = JSON.parse(exported.json);
  assert.equal(parsed.collections.tasks.length, 1); assert.equal(exported.json.includes('bob secret'), false);
  await error(call('data.delete', { scope: { collection: 'tasks', records: [{ id: a.id, version: 1 }] } }), 'CONFIRMATION_REQUIRED');
  await error(call('data.delete', { confirmed: true, scope: { collection: 'tasks', records: [{ id: a.id, version: 9 }] } }), 'CONFLICT');
  assert.equal((await success(call('tasks.list'))).length, 1);
  await success(call('data.delete', { confirmed: true, scope: { collection: 'tasks', records: [{ id: a.id, version: 1 }] } }));
  assert.equal((await success(call('tasks.list'))).length, 0); assert.equal((await success(call('tasks.list', {}, 'bob'))).length, 1);
});
test('cloud entry ignores client owner and suppresses vendor errors and missing WX identity', async () => {
  const { deps } = setup(); assert.ok(api && api.createHandler, 'secure CloudBase entry must exist');
  const entry = api.createHandler({ ...deps, getWXContext: () => ({ OPENID: 'alice' }) });
  const result = await entry({ owner: 'bob', ownerOpenId: 'bob', action: 'tasks.create', payload: { record: task() } });
  assert.equal(result.data.ownerOpenId, 'alice');
  assert.equal((await api.createHandler({ ...deps, getWXContext: () => ({}) })({ action: 'tasks.list' })).error.code, 'UNAUTHENTICATED');
  const broken = api.createHandler({ ...deps, repository: { list: async () => { throw new Error('vendor secret token'); } }, getWXContext: () => ({ OPENID: 'alice' }) });
  const failure = await broken({ action: 'tasks.list' }); assert.equal(failure.error.code, 'INTERNAL'); assert.equal(JSON.stringify(failure).includes('vendor secret'), false);
});

test('updates never expose repository internal collection metadata', async () => {
  const { call } = setup(); const original = await success(call('tasks.create', { record: task() }));
  const updated = await success(call('tasks.update', { id: original.id, expectedVersion: 1, patch: { title: 'updated' } }));
  assert.equal(Object.hasOwn(updated, '_collection'), false);
});
test('production bootstrap configures missing CloudBase documents as null instead of SDK default throwing', async () => {
  assert.equal(typeof api.createProductionHandler, 'function');
  let configured = false;
  const cloud = { DYNAMIC_CURRENT_ENV: 'dynamic-test', init(options) { assert.deepEqual(options, { env: 'dynamic-test' }); }, getWXContext: () => ({ OPENID: 'alice' }), database(options) { configured = options.throwOnNotFound === false; return { runTransaction() {}, collection() { return { where() { return { orderBy() { return this; }, skip() { return this; }, limit() { return this; }, get: async () => ({ data: [] }) }; } }; } }; } };
  const entry = api.createProductionHandler(cloud); assert.equal(configured, true);
  assert.deepEqual(await entry({ action: 'tasks.list' }), { ok: true, data: [] });
});
