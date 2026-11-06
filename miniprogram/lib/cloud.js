'use strict';
// 云函数调用封装。
//
// 云函数（cloudfunctions/api）的契约：
//   成功 → { ok: true, data: <结果> }
//   失败 → { ok: false, error: { code, message } }
// 它**不抛异常**，所以这里要自己判断 ok，再把错误统一转成 reject，
// 让调用方能用 try/catch 处理。调用方永远不需要关心 result 的形状。
//
// 注意：本文件只负责「调得通」，不负责数据迁移。
// 本地 store 与后端模型存在结构差异（学期是字符串 vs 引用、本地 id vs 云端 id），
// 迁移策略见项目根目录的上云接入清单，不要在页面里偷偷做。

const { envId, apiFunctionName } = require('../config');

// 本地试用字段 ↔ 后端正式枚举。两边不一致，任何跨端写入都必须过这层。
const STATUS_LOCAL_TO_SERVER = { open: 'pending', completed: 'completed', cancelled: 'cancelled', in_progress: 'in_progress' };
const STATUS_SERVER_TO_LOCAL = { pending: 'open', in_progress: 'open', completed: 'completed', cancelled: 'open' };
const TYPE_LOCAL_TO_SERVER = { homework: 'assignment', experiment: 'experiment', exam: 'exam', other: 'other' };
const TYPE_SERVER_TO_LOCAL = { assignment: 'homework', experiment: 'experiment', exam: 'exam', group: 'other', study: 'other', other: 'other' };
const RECORD_COLLECTIONS = ['profiles', 'semesters', 'courses', 'tasks'];

class CloudError extends Error {
  constructor(code, message) {
    super(message || '云服务不可用');
    this.name = 'CloudError';
    this.code = code;
  }
}

// 未配置 envId 时整个云端能力应静默关闭，界面继续走本地模式。
function available() {
  return Boolean(envId) && typeof wx !== 'undefined' && Boolean(wx.cloud);
}

function reasonFor(code) {
  const table = {
    CLOUD_UNAVAILABLE: '当前是本地模式，未接入云环境',
    NETWORK: '网络或云函数调用失败',
    FUNCTION_NOT_FOUND: '云函数 api 还没部署',
    UNAUTHENTICATED: '拿不到微信身份，检查是否在真机/开发者工具登录',
    VALIDATION: '字段不合法，检查必填项与枚举值',
    NOT_FOUND: '记录不存在或不属于当前用户',
    CONFLICT: '记录已被修改，需要重新读取后再改',
    HAS_DEPENDENTS: '有下级记录引用它，先处理引用',
    UNKNOWN_ACTION: '云函数不认识这个 action',
    INTERNAL: '云函数内部错误，看云端日志'
  };
  return table[code] || code || '未知错误';
}

async function call(action, payload = {}) {
  if (!available()) throw new CloudError('CLOUD_UNAVAILABLE', reasonFor('CLOUD_UNAVAILABLE'));

  let result;
  try {
    const response = await wx.cloud.callFunction({
      name: apiFunctionName,
      data: { action, payload }
    });
    result = response && response.result;
  } catch (error) {
    const message = (error && (error.errMsg || error.message)) || '';
    // 云函数没部署时微信会抛 -501000 / FUNCTION_NOT_FOUND，单独给个可读的码。
    const code = /FUNCTION_NOT_FOUND|-501000/.test(message) ? 'FUNCTION_NOT_FOUND' : 'NETWORK';
    throw new CloudError(code, `${reasonFor(code)}（${message || '无详细信息'}）`);
  }

  if (!result || result.ok !== true) {
    const detail = (result && result.error) || {};
    const code = detail.code || 'INTERNAL';
    throw new CloudError(code, detail.message || reasonFor(code));
  }
  return result.data;
}

// ---- 记录读写：action 形如 'tasks.list'，与云函数 handleRecords 的分派一致 ----

const records = {
  list(collection, query = {}) {
    if (!RECORD_COLLECTIONS.includes(collection)) return Promise.reject(new CloudError('VALIDATION', '不支持的集合'));
    return call(`${collection}.list`, { query });
  },
  get(collection, id) {
    return call(`${collection}.get`, { id });
  },
  create(collection, record) {
    return call(`${collection}.create`, { record });
  },
  // 后端每个记录带 version，改之前必须带上来时读到的版本，否则 CONFLICT。
  update(collection, id, expectedVersion, patch) {
    return call(`${collection}.update`, { id, expectedVersion, patch });
  },
  // 云函数强制要求 confirmed: true，避免误删。
  remove(collection, id, expectedVersion) {
    return call(`${collection}.delete`, { id, expectedVersion, confirmed: true });
  }
};

// ---- 连通性探针 ----
// 分两步，因为云函数把所有内部异常都压成 INTERNAL，单靠返回码分不清是
// 「运行时版本不够」还是「集合没建」：
//   第一步 system.ping —— 不碰数据库，只回报 node 版本和 structuredClone 是否存在；
//   第二步 tasks.list  —— 真正读一次库，验证集合与权限。
async function probe() {
  if (!envId) return { ok: false, code: 'CLOUD_UNAVAILABLE', message: reasonFor('CLOUD_UNAVAILABLE'), hint: '在 miniprogram/config.js 填入 envId' };
  if (!available()) return { ok: false, code: 'CLOUD_UNAVAILABLE', message: reasonFor('CLOUD_UNAVAILABLE'), hint: '当前基础库不支持 wx.cloud，或不在小程序环境' };

  const callHints = {
    FUNCTION_NOT_FOUND: '右键 cloudfunctions/api → 上传并部署：云端安装依赖',
    UNAUTHENTICATED: '开发者工具里重新登录，并确认当前微信号是小程序开发者',
    VALIDATION: '检查 envId 是否属于当前 AppID',
    INTERNAL: '看云开发控制台 → 云函数 → api → 日志 里的真实堆栈'
  };

  // 第一步：运行时自检
  let ping;
  try {
    ping = await call('system.ping', {});
  } catch (error) {
    const code = error.code || 'INTERNAL';
    if (code === 'UNKNOWN_ACTION') {
      return {
        ok: false,
        code: 'FUNCTION_OUTDATED',
        message: '云函数是旧版本，不认识 system.ping 这个诊断动作',
        hint: '重新右键 cloudfunctions/api → 上传并部署：云端安装依赖（本次新增了诊断动作）'
      };
    }
    return { ok: false, code, message: error.message, hint: callHints[code] || '' };
  }

  if (!ping || ping.runtimeReady !== true) {
    const version = (ping && ping.node) || '未知';
    return {
      ok: false,
      code: 'RUNTIME_TOO_OLD',
      message: `云函数运行时是 ${version}，不支持 structuredClone（需要 Node 17 以上）`,
      hint: '云开发控制台 → 云函数 → api → 配置 → 运行时改成 Nodejs20.19，保存后重新部署',
      node: version
    };
  }

  // 第二步：数据库读取
  try {
    const data = await records.list('tasks', {});
    const count = Array.isArray(data) ? data.length : (data && Array.isArray(data.items) ? data.items.length : 0);
    return { ok: true, code: 'OK', message: `云端已连通（${ping.node}），tasks 集合可读，现有 ${count} 条`, count, node: ping.node };
  } catch (error) {
    const code = error.code || 'INTERNAL';
    const hints = {
      INTERNAL: '运行时已确认正常（' + ping.node + '），所以基本就是 tasks 集合还没创建。去云开发控制台 → 数据库 → 新建集合 tasks，再测一次',
      VALIDATION: '这多半是云开发安全规则挡住了读操作，检查 database 权限设置',
      NOT_FOUND: '身份归属异常，确认 OPENID 是否稳定',
      UNAUTHENTICATED: '拿不到 OPENID，重新登录开发者工具'
    };
    return { ok: false, code, message: error.message, hint: hints[code] || '', node: ping.node };
  }
}

module.exports = {
  CloudError,
  available,
  call,
  records,
  probe,
  reasonFor,
  RECORD_COLLECTIONS,
  STATUS_LOCAL_TO_SERVER,
  STATUS_SERVER_TO_LOCAL,
  TYPE_LOCAL_TO_SERVER,
  TYPE_SERVER_TO_LOCAL
};
