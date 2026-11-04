'use strict';
const { fail } = require('./errors');
const { COLLECTIONS } = require('../adapters/repository');
const fields = Object.freeze({
  profiles: ['displayName', 'timezone', 'studyGoal'],
  semesters: ['name', 'startDate', 'endDate', 'teachingWeeks'],
  courses: ['name', 'semesterId', 'teacher', 'schedule', 'notes'],
  tasks: ['title', 'description', 'type', 'status', 'dueAt', 'courseId', 'parentTaskId', 'examScope', 'remainingMinutes', 'estimatedMinutes', 'personalResponsibility', 'schedule', 'priority', 'fixed', 'completedAt']
});
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max = 2000) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function due(value) { return value === null || date(value) || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)) && date(value.slice(0, 10))); }
function numbers(value, max) { return Array.isArray(value) && value.length > 0 && value.length <= max && new Set(value).size === value.length && value.every(n => Number.isInteger(n) && n >= 1 && n <= max); }
function schedule(value) { return isObject(value) && Number.isInteger(value.weekday) && value.weekday >= 1 && value.weekday <= 7 && numbers(value.weeks, 60) && numbers(value.periods, 24) && (value.location === undefined || text(value.location, 300)); }
function select(collection, input) {
  if (!fields[collection] || !isObject(input)) fail('VALIDATION');
  const result = {}; for (const key of fields[collection]) if (Object.hasOwn(input, key) && key !== 'completedAt') result[key] = structuredClone(input[key]);
  return result;
}
function validate(collection, record) {
  if (collection === 'profiles') {
    if (!text(record.displayName, 100) || (record.timezone !== undefined && record.timezone !== 'Asia/Shanghai')) fail('VALIDATION');
  } else if (collection === 'semesters') {
    if (!text(record.name, 100) || !date(record.startDate) || !date(record.endDate) || record.startDate > record.endDate || !Number.isInteger(record.teachingWeeks) || record.teachingWeeks < 1 || record.teachingWeeks > 60) fail('VALIDATION');
  } else if (collection === 'courses') {
    if (!text(record.name, 100) || !text(record.semesterId, 128) || !Array.isArray(record.schedule) || record.schedule.length > 100 || !record.schedule.every(schedule)) fail('VALIDATION');
  } else if (collection === 'tasks') {
    if (!text(record.title, 300) || !['assignment', 'exam', 'group', 'study', 'other'].includes(record.type) || !['pending', 'in_progress', 'completed', 'cancelled'].includes(record.status) || !due(record.dueAt) || !Number.isInteger(record.remainingMinutes) || record.remainingMinutes < 0 || record.remainingMinutes > 100000) fail('VALIDATION');
    if (record.estimatedMinutes !== undefined && (!Number.isInteger(record.estimatedMinutes) || record.estimatedMinutes < 0 || record.estimatedMinutes > 100000)) fail('VALIDATION');
    if (record.examScope !== undefined && !(text(record.examScope, 5000) || (Array.isArray(record.examScope) && record.examScope.length <= 100 && record.examScope.every(v => text(v, 500))))) fail('VALIDATION');
    if (record.personalResponsibility !== undefined && !text(record.personalResponsibility, 5000)) fail('VALIDATION');
    if (record.schedule !== undefined && !schedule(record.schedule)) fail('VALIDATION');
    if (record.priority !== undefined && !['low', 'medium', 'high'].includes(record.priority)) fail('VALIDATION');
    if (record.fixed !== undefined && typeof record.fixed !== 'boolean') fail('VALIDATION');
    for (const key of ['courseId', 'parentTaskId']) if (record[key] != null && !text(record[key], 128)) fail('VALIDATION');
  }
  for (const key of ['description', 'notes', 'teacher', 'studyGoal']) if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > 10000)) fail('VALIDATION');
}
async function getRecord(repository, owner, collection, id) {
  const record = await repository.get(owner, collection, id);
  if (!record || record.deletedAt) fail('NOT_FOUND'); return record;
}
async function references(repository, owner, collection, record) {
  const reference = async (c, id) => { try { return await getRecord(repository, owner, c, id); } catch (e) { if (e.code === 'NOT_FOUND' || e.code === 'VALIDATION') fail('INVALID_REFERENCE'); throw e; } };
  if (collection === 'courses') {
    const semester = await reference('semesters', record.semesterId);
    if (record.schedule.some(s => s.weeks.some(w => w > semester.teachingWeeks))) fail('VALIDATION');
  }
  if (collection === 'tasks') {
    if (record.courseId) await reference('courses', record.courseId);
    const seen = new Set([record.id]); let parentId = record.parentTaskId;
    while (parentId) {
      if (seen.has(parentId)) fail('INVALID_REFERENCE'); seen.add(parentId);
      const parent = await reference('tasks', parentId);
      if ((parent.courseId || null) !== (record.courseId || null)) fail('INVALID_REFERENCE');
      parentId = parent.parentTaskId;
    }
  }
}
async function writeRecord(repository, owner, collection, input, previous, expectedVersion, deps) {
  const selected = select(collection, input);
  const record = previous ? { ...previous, ...selected } : { ...selected, id: deps.newId() };
  if (collection === 'profiles' && !record.timezone) record.timezone = 'Asia/Shanghai';
  if (collection === 'courses' && !record.schedule) record.schedule = [];
  if (collection === 'tasks') {
    if (record.dueAt === undefined) record.dueAt = null;
    if (!record.status) record.status = 'pending'; if (!record.type) record.type = 'assignment';
    record.completedAt = record.status === 'completed' ? (previous?.completedAt || deps.now()) : null;
  }
  validate(collection, record); await references(repository, owner, collection, record);
  return repository.save(owner, collection, record, expectedVersion);
}
async function hasDependents(repository, owner, collection, id, deleting = new Set()) {
  if (collection === 'semesters') return (await repository.list(owner, 'courses', { semesterId: id })).some(r => !deleting.has(`courses:${r.id}`));
  if (collection === 'courses') return (await repository.list(owner, 'tasks', { courseId: id })).some(r => !deleting.has(`tasks:${r.id}`));
  if (collection === 'tasks') return (await repository.list(owner, 'tasks', { parentTaskId: id })).some(r => !deleting.has(`tasks:${r.id}`));
  return false;
}
async function removeRecords(repository, owner, collection, records) {
  const deleting = new Set(records.map(r => `${collection}:${r.id}`));
  for (const item of records) {
    const existing = await getRecord(repository, owner, collection, item.id);
    if (existing.version !== item.version) fail('CONFLICT');
    if (await hasDependents(repository, owner, collection, item.id, deleting)) fail('HAS_DEPENDENTS');
  }
  for (const item of records) await repository.remove(owner, collection, item.id, item.version);
  return { count: records.length, collection, ids: records.map(r => r.id) };
}
async function handleRecords({ owner, action, payload }, deps) {
  const [collection, verb] = action.split('.');
  if (fields[collection]) {
    if (verb === 'get') return getRecord(deps.repository, owner, collection, payload.id);
    if (verb === 'list') {
      const query = payload.query || {}; const allowed = ['status', 'courseId', 'semesterId', 'parentTaskId', 'type'];
      if (!isObject(query) || Object.keys(query).some(k => !allowed.includes(k) || !['string', 'number', 'boolean'].includes(typeof query[k]))) fail('VALIDATION');
      return deps.repository.list(owner, collection, query);
    }
    if (verb === 'create') return deps.repository.transaction(owner, async tx => {
      if (collection === 'profiles' && (await tx.list(owner, collection)).length) fail('CONFLICT');
      return writeRecord(tx, owner, collection, payload.record, null, 0, deps);
    });
    if (verb === 'update') return deps.repository.transaction(owner, async tx => {
      const record = await getRecord(tx, owner, collection, payload.id);
      if (record.version !== payload.expectedVersion) fail('CONFLICT');
      return writeRecord(tx, owner, collection, payload.patch, record, payload.expectedVersion, deps);
    });
    if (verb === 'delete') {
      if (payload.confirmed !== true) fail('CONFIRMATION_REQUIRED');
      return deps.repository.transaction(owner, tx => removeRecords(tx, owner, collection, [{ id: payload.id, version: payload.expectedVersion }]));
    }
  }
  if (action === 'data.export') return deps.repository.transaction(owner, async tx => {
    const collections = {}; for (const name of COLLECTIONS) collections[name] = await tx.list(owner, name);
    return { format: 'study-agent/v1', json: JSON.stringify({ format: 'study-agent/v1', exportedAt: deps.now(), collections }) };
  });
  if (action === 'data.delete') {
    if (payload.confirmed !== true) fail('CONFIRMATION_REQUIRED');
    const scope = payload.scope;
    if (!isObject(scope) || !COLLECTIONS.includes(scope.collection) || !Array.isArray(scope.records) || scope.records.length < 1 || scope.records.length > 100 || new Set(scope.records.map(r => r.id)).size !== scope.records.length || !scope.records.every(r => isObject(r) && typeof r.id === 'string' && Number.isInteger(r.version) && r.version > 0)) fail('VALIDATION');
    return deps.repository.transaction(owner, tx => removeRecords(tx, owner, scope.collection, scope.records));
  }
  fail('UNKNOWN_ACTION');
}
module.exports = { handleRecords, writeRecord, getRecord, isObject, date, due, schedule, select, validate };
