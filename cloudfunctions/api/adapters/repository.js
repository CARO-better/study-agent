'use strict';
const { createHash } = require('node:crypto');
const { fail } = require('../core/errors');
const COLLECTIONS = Object.freeze(['profiles', 'semesters', 'courses', 'tasks', 'importDrafts', 'plans', 'planRevisions']);
const clone = value => value == null ? value : structuredClone(value);
function check(owner, collection, id) {
  if (typeof owner !== 'string' || !owner.trim()) fail('UNAUTHENTICATED');
  if (!COLLECTIONS.includes(collection) || (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))) fail('VALIDATION');
}
function prepare(owner, current, record, expectedVersion, now) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || (current ? current.version : 0) !== expectedVersion) fail('CONFLICT');
  if (current && current.ownerOpenId !== owner) fail('NOT_FOUND');
  const next = { ...clone(record), ownerOpenId: owner, version: expectedVersion + 1, createdAt: current ? current.createdAt : now(), updatedAt: now() };
  delete next._id; delete next._openid;
  return next;
}
function matches(record, query = {}) {
  return !record.deletedAt && Object.entries(query).every(([key, value]) => record[key] === value);
}
function createMemoryRepository({ now = () => new Date().toISOString() } = {}) {
  let store = new Map(), tail = Promise.resolve();
  function view(data, owner) {
    const key = (collection, id) => `${collection}:${owner}:${id}`;
    return {
      async get(o, collection, id) { check(o, collection, id); if (o !== owner) fail('NOT_FOUND'); const record = clone(data.get(key(collection, id)) || null); if (record) delete record._collection; return record; },
      async list(o, collection, query = {}) { check(o, collection); if (o !== owner) fail('NOT_FOUND'); return [...data.values()].filter(r => r.ownerOpenId === owner && r._collection === collection && matches(r, query)).map(r => { const v = clone(r); delete v._collection; return v; }); },
      async save(o, collection, record, expectedVersion) { check(o, collection, record.id); if (o !== owner) fail('NOT_FOUND'); const next = prepare(o, data.get(key(collection, record.id)), record, expectedVersion, now); data.set(key(collection, record.id), { ...next, _collection: collection }); return clone(next); },
      async remove(o, collection, id, expectedVersion) { check(o, collection, id); if (o !== owner) fail('NOT_FOUND'); const old = data.get(key(collection, id)); if (!old) fail('NOT_FOUND'); if (old.version !== expectedVersion) fail('CONFLICT'); data.delete(key(collection, id)); }
    };
  }
  const repository = {
    async transaction(owner, callback) {
      check(owner, 'profiles');
      let release; const previous = tail; tail = new Promise(resolve => { release = resolve; }); await previous;
      const copy = new Map([...store].map(([k, v]) => [k, clone(v)]));
      try { const result = await callback(view(copy, owner)); store = copy; return result; } finally { release(); }
    },
    async get(owner, collection, id) { const r = await view(store, owner).get(owner, collection, id); if (r) delete r._collection; return r; },
    async list(owner, collection, query) { return view(store, owner).list(owner, collection, query); },
    async save(owner, collection, record, expectedVersion) { return repository.transaction(owner, tx => tx.save(owner, collection, record, expectedVersion)); }
  };
  return repository;
}
// Uses the documented wx-server-sdk transaction API. No credentials are needed here;
// the deployed function's service identity is supplied by CloudBase.
function createCloudBaseRepository(db, { now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new TypeError('CloudBase database required');
  const docId = (owner, id) => createHash('sha256').update(`${owner}\0${id}`).digest('hex');
  async function read(client, owner, collection, id) {
    check(owner, collection, id);
    const response = await client.collection(collection).doc(docId(owner, id)).get();
    const record = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!record || record.ownerOpenId !== owner || record.id !== id) return null;
    const result = clone(record); delete result._id; delete result._openid; return result;
  }
  async function list(owner, collection, query = {}) {
    check(owner, collection);
    // Only equality on known safe fields. Never accept a client query operator or owner filter.
    const allowed = ['status', 'courseId', 'semesterId', 'parentTaskId', 'type'];
    if (Object.keys(query).some(k => !allowed.includes(k) || !['string', 'number', 'boolean'].includes(typeof query[k]))) fail('VALIDATION');
    const records = []; let offset = 0;
    for (;;) {
      const page = await db.collection(collection).where({ ...query, ownerOpenId: owner }).orderBy('_id', 'asc').skip(offset).limit(100).get();
      for (const record of page.data || []) { if (record.ownerOpenId === owner && matches(record, query)) { const v = clone(record); delete v._id; delete v._openid; records.push(v); } }
      if (!page.data || page.data.length < 100) break;
      offset += page.data.length;
    }
    return records;
  }
  const repository = {
    get: (owner, collection, id) => read(db, owner, collection, id), list,
    async transaction(owner, callback) {
      check(owner, 'profiles');
      let result;
      await db.runTransaction(async transaction => {
        // Every writer for one owner updates this guard. This serializes cross-record
        // reference checks and non-transactional paginated reads (SDK transactions only support doc()).
        const guard = transaction.collection('ownerLocks').doc(docId(owner, 'lock'));
        const response = await guard.get();
        const old = Array.isArray(response.data) ? response.data[0] : response.data;
        const tx = {
          get: (o, c, id) => { if (o !== owner) fail('NOT_FOUND'); return read(transaction, o, c, id); },
          list: (o, c, q) => { if (o !== owner) fail('NOT_FOUND'); return list(o, c, q); },
          async remove(o, c, id, expectedVersion) {
            if (o !== owner) fail('NOT_FOUND'); const current = await read(transaction, o, c, id);
            if (!current) fail('NOT_FOUND'); if (current.version !== expectedVersion) fail('CONFLICT');
            await transaction.collection(c).doc(docId(o, id)).remove();
          },
          async save(o, c, record, expectedVersion) {
            check(o, c, record.id); if (o !== owner) fail('NOT_FOUND');
            const current = await read(transaction, o, c, record.id);
            const next = prepare(o, current, record, expectedVersion, now);
            await transaction.collection(c).doc(docId(o, record.id)).set({ data: next });
            return next;
          }
        };
        result = await callback(tx);
        await guard.set({ data: { ownerOpenId: owner, version: (old?.version || 0) + 1, updatedAt: now() } });
      });
      return result;
    },
    save(owner, collection, record, expectedVersion) { return repository.transaction(owner, tx => tx.save(owner, collection, record, expectedVersion)); }
  };
  return repository;
}
module.exports = { COLLECTIONS, createMemoryRepository, createCloudBaseRepository };
