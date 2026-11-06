'use strict';
// 整份快照同步：每个用户在 snapshots 集合里固定一条记录（id='default'），
// payload 是本地 store 的完整 JSON。
//
// 为什么不做逐条同步：本地 id 由 uid() 生成，后端用 randomUUID 且会丢弃前端 id，
// 两套 id 体系要同步就得维护映射表 + 删除队列 + 逐条版本比对，任何一处错都会静默丢数据。
// 个人单设备场景下，整份覆盖更可靠：写入是原子的，读取是完整的，不存在「同步了一半」。
//
// 冲突策略：expectedRevision 原子比较，旧客户端不能覆盖较新的快照。
// payload 的 UTF-8 字节数超过 512KiB 时拒绝写入。

const MAX_PAYLOAD_BYTES = 512 * 1024;
const { fail } = require('./errors');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateStore(store) {
  if (!isObject(store) || !['courses','tasks','availability','blocks','unscheduled'].every(k => Array.isArray(store[k]) && store[k].length <= 10000 && store[k].every(isObject))) fail('VALIDATION');
  for (const key of ['courses','tasks']) {
    if (!store[key].every(r => typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200) || new Set(store[key].map(r => r.id)).size !== store[key].length) fail('VALIDATION');
  }
  if (Buffer.byteLength(JSON.stringify(store),'utf8') > MAX_PAYLOAD_BYTES) fail('VALIDATION');
  return store;
}

async function handleSnapshots({ owner, action, payload }, deps) {
  const repo = deps.repository;

  if (action === 'sync.pull') {
    const record = await repo.get(owner, 'snapshots', 'default');
    if (!record) return { payload: null, revision: 0, updatedAt: null };
    return { payload: record.payload, revision: record.revision || 0, updatedAt: record.updatedAt || null };
  }

  if (action === 'sync.push' || action === 'sync.plan') {
    let store = payload && payload.store;
    validateStore(store);
    if(action === 'sync.plan') {
      store = require('./study-plan').generate(store,deps.now());
      validateStore(store);
    }
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail('VALIDATION');
    const json = JSON.stringify(store);

    // 记录本次写入的来源设备与时间，方便排查「为什么我的改动没了」
    const device = typeof payload.device === 'string' ? payload.device.slice(0, 64) : '';

    const saved = await repo.transaction(owner, async tx => {
      const prev = await tx.get(owner, 'snapshots', 'default');
      if ((prev && prev.revision || 0) !== payload.expectedRevision) fail('CONFLICT');
      const record = {
        id: 'default',
        payload: store,
        revision: (prev && prev.revision ? prev.revision : 0) + 1,
        device,
        updatedAt: deps.now()
      };
      return tx.save(owner, 'snapshots', record, prev && prev.version ? prev.version : 0);
    });
    return { revision: saved.revision, updatedAt: saved.updatedAt, bytes: Buffer.byteLength(json,'utf8'), ...(action === 'sync.plan'?{store:saved.payload}:{}) };
  }

  fail('UNKNOWN_ACTION');
}

module.exports = { handleSnapshots, validateStore, MAX_PAYLOAD_BYTES };
