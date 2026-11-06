'use strict';
// 整份快照同步的前端层。
//
// 思路：本地 store 是唯一操作对象，云端只做备份。
//   - 本地改了 → save() 后把整份 store 推上去（防抖 800ms，避免连续操作连发）
//   - 启动时 → 先读本地立即可用，再异步拉云端；云端更新时覆盖本地
//
// 冲突策略：比时间戳，后写覆盖前写。多设备同时改会互相覆盖 —— 这是整份覆盖方案的固有取舍，
// 换来的是「不会因为 id 对不上而静默丢数据」。

const cloud = require('./cloud');

const STAMP_KEY = 'study_sync_stamp_v1';
const PUSH_DELAY = 800;

let timer = null;
let pending = null;
let pushing = null;

function nowIso() { return new Date().toISOString(); }

function localStamp() {
  try { return wx.getStorageSync(STAMP_KEY) || ''; } catch (error) { return ''; }
}

// 本地一有改动就立刻打戳，这样即使 push 还没发出去，也不会在 pull 时被云端旧数据覆盖。
function markLocal(stamp) {
  const value = stamp || nowIso();
  try { wx.setStorageSync(STAMP_KEY, value); } catch (error) { /* 存不下就放弃，不影响主流程 */ }
  return value;
}

function deviceTag() {
  try {
    const info = wx.getSystemInfoSync();
    return String((info && info.model) || 'unknown').slice(0, 32);
  } catch (error) { return 'unknown'; }
}

async function pull() {
  const data = await cloud.call('sync.pull', {});
  return { store: data.payload, revision: data.revision || 0, updatedAt: data.updatedAt || null };
}

async function pushNow(store) {
  const data = await cloud.call('sync.push', { store, device: deviceTag() });
  // 用服务端返回的时间戳回写，保证两端时间基准一致（手机时钟可能不准）
  markLocal(data.updatedAt || nowIso());
  return data;
}

// 防抖推送：连续 save 只发最后一次。
function schedule(store) {
  if (!cloud.available()) return;
  pending = store;
  markLocal();
  if (timer) clearTimeout(timer);
  timer = setTimeout(function fire() {
    timer = null;
    const snapshot = pending;
    pending = null;
    if (!snapshot) return;
    pushing = pushNow(snapshot).catch(function swallow(error) {
      console.warn('[sync] 推送失败', error && error.code, error && error.message);
    }).then(function clear() { pushing = null; });
  }, PUSH_DELAY);
}

// 页面隐藏 / 卸载时立刻把待发的推上去，别等到下一次启动。
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  const snapshot = pending;
  pending = null;
  if (snapshot) {
    try { return await pushNow(snapshot); }
    catch (error) { console.warn('[sync] flush 失败', error && error.code); return null; }
  }
  if (pushing) { try { await pushing; } catch (error) { /* 已记录 */ } }
  return null;
}

// 决定用谁的数据。纯函数，方便单测和解释。
// 返回 'remote' 表示云端更新、应覆盖本地；'local' 表示保持本地。
function decide(remoteUpdatedAt, stamp, localIsEmpty) {
  if (!remoteUpdatedAt) return 'local';          // 云端还没有数据
  if (localIsEmpty) return 'remote';             // 本地空（清过缓存/新设备）
  if (!stamp) return 'remote';                   // 本地没有时间戳，保守以云端为准
  return remoteUpdatedAt > stamp ? 'remote' : 'local';
}

module.exports = { pull, pushNow, schedule, flush, decide, localStamp, markLocal, deviceTag, STAMP_KEY, PUSH_DELAY };
