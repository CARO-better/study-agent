'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRepository, createCloudBaseRepository } = require('../cloudfunctions/api/adapters/repository');
// A local transport double for the external database only. All repository behavior is production code.
// Model wx-server-sdk doc responses ({data: object}), staged writes and rollback; no cloud/network calls.
function cloudTransport() {
  let data = new Map(), tail = Promise.resolve();
  const client = (readData, writeData, transactional = false) => ({
    collection(collection) {
      const query = (filter = {}, offset = 0, limit = 100) => ({
        orderBy(field, direction) { assert.equal(field, '_id'); assert.equal(direction, 'asc'); return this; },
        skip(n) { return query(filter, n, limit); }, limit(n) { return query(filter, offset, n); },
        async get() { assert.equal(transactional, false, 'SDK transactions do not support query scans'); return { data: [...readData.values()].filter(v => v.collection === collection).map(v => v.record).filter(r => Object.entries(filter).every(([k, v]) => r[k] === v)).sort((a, b) => a._id.localeCompare(b._id)).slice(offset, offset + limit).map(r => structuredClone(r)) }; }
      });
      return {
        where(filter) { assert.equal(typeof filter.ownerOpenId, 'string'); return query(filter); },
        doc(id) { assert.match(id, /^[a-f0-9]{64}$/); const key = `${collection}:${id}`; return {
          async get() { return { data: structuredClone(readData.get(key)?.record || null) }; },
          async set(input) { assert.deepEqual(Object.keys(input), ['data']); writeData.set(key, { collection, record: { ...structuredClone(input.data), _id: id } }); },
          async remove() { writeData.delete(key); }
        }; }
      };
    }
  });
  const db = {
    collection: name => client(data, data).collection(name),
    async runTransaction(callback) {
      let release; const previous = tail; tail = new Promise(r => { release = r; }); await previous;
      const staged = structuredClone(data);
      try { const result = await callback(client(staged, staged, true)); data = staged; return { result, errMsg: 'runTransaction:ok' }; } finally { release(); }
    }
  };
  return db;
}
for (const [name, factory] of [['memory', options => createMemoryRepository(options)], ['CloudBase adapter/local transport', options => createCloudBaseRepository(cloudTransport(), options)]]) {
  test(`${name}: ownership/version contract and copy isolation`, async () => {
    const repo = factory({ now: () => '2026-11-04T02:00:00.000Z' });
    const created = await repo.save('alice', 'tasks', { id: 'same', ownerOpenId: 'bob', version: 999, title: 'A', details: { x: 1 } }, 0);
    assert.equal(created.ownerOpenId, 'alice'); assert.equal(created.version, 1); created.details.x = 99;
    assert.equal((await repo.get('alice', 'tasks', 'same')).details.x, 1);
    assert.equal(await repo.get('bob', 'tasks', 'same'), null);
    await repo.save('bob', 'tasks', { id: 'same', title: 'B' }, 0);
    assert.deepEqual((await repo.list('alice', 'tasks')).map(r => r.title), ['A']);
    const updated = await repo.save('alice', 'tasks', { id: 'same', title: 'updated' }, 1);
    assert.equal(updated.createdAt, '2026-11-04T02:00:00.000Z'); assert.equal(updated.version, 2);
    await assert.rejects(repo.save('alice', 'tasks', { id: 'same', title: 'stale' }, 1), e => e.code === 'CONFLICT');
    assert.equal(Object.keys(await repo.get('alice', 'tasks', 'same')).some(k => ['_id', '_openid', '_collection'].includes(k)), false);
  });
  test(`${name}: multi-record failure rolls back and confirmed removal is physical`, async () => {
    const repo = factory(); await repo.save('alice', 'tasks', { id: 'a', title: 'original' }, 0);
    await assert.rejects(repo.transaction('alice', async tx => { await tx.save('alice', 'tasks', { id: 'new' }, 0); await tx.save('alice', 'tasks', { id: 'a', title: 'bad' }, 0); }), e => e.code === 'CONFLICT');
    assert.equal(await repo.get('alice', 'tasks', 'new'), null);
    await repo.transaction('alice', tx => tx.remove('alice', 'tasks', 'a', 1));
    assert.equal(await repo.get('alice', 'tasks', 'a'), null);
  });
  test(`${name}: pagination never silently truncates exports and transaction owner cannot be overridden`, async () => {
    const repo = factory();
    await repo.transaction('alice', async tx => { for (let i = 0; i < 205; i++) await tx.save('alice', 'tasks', { id: `r${i}`, title: 'A' }, 0); });
    assert.equal((await repo.list('alice', 'tasks')).length, 205);
    await assert.rejects(repo.transaction('alice', tx => tx.save('bob', 'tasks', { id: 'attack' }, 0)), e => e.code === 'NOT_FOUND');
    assert.equal((await repo.list('bob', 'tasks')).length, 0);
  });
}
