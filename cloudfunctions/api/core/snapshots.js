'use strict';
// 整份快照同步：每个用户在 snapshots 集合里固定一条记录（id='default'），
// payload 是本地 store 的完整 JSON。
//
// 为什么不做逐条同步：本地 id 由 uid() 生成，后端用 randomUUID 且会丢弃前端 id，
// 两套 id 体系要同步就得维护映射表 + 删除队列 + 逐条版本比对，任何一处错都会静默丢数据。
// 个人单设备场景下，整份覆盖更可靠：写入是原子的，读取是完整的，不存在「同步了一半」。
//
// 冲突策略：按 updatedAt 后写覆盖前写。多设备同时改会互相覆盖，这是已知取舍。
// 单文档上限 1MB，payload 超过 512KB 直接拒绝，避免写到一半超限。

const MAX_PAYLOAD_BYTES = 512 * 1024;
const { fail } = require('./errors');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function handleSnapshots({ owner, action, payload }, deps) {
  const repo = deps.repository;

  if (action === 'sync.pull') {
    const record = await repo.get(owner, 'snapshots', 'default');
    if (!record) return { payload: null, revision: 0, updatedAt: null };
    return { payload: record.payload, revision: record.revision || 0, updatedAt: record.updatedAt || null };
  }

  if (action === 'sync.push') {
    const store = payload && payload.store;
    if (!isObject(store)) fail('VALIDATION');
    const json = JSON.stringify(store);
    if (json.length > MAX_PAYLOAD_BYTES) fail('VALIDATION');

    // 记录本次写入的来源设备与时间，方便排查「为什么我的改动没了」
    const device = typeof payload.device === 'string' ? payload.device.slice(0, 64) : '';

    const saved = await repo.transaction(owner, async tx => {
      const prev = await tx.get(owner, 'snapshots', 'default');
      const record = {
        id: 'default',
        payload: store,
        revision: (prev && prev.revision ? prev.revision : 0) + 1,
        device,
        updatedAt: deps.now()
      };
      return tx.save(owner, 'snapshots', record, prev && prev.version ? prev.version : 0);
    });
    return { revision: saved.revision, updatedAt: saved.updatedAt, bytes: json.length };
  }

  fail('UNKNOWN_ACTION');
}

module.exports = { handleSnapshots, MAX_PAYLOAD_BYTES };
