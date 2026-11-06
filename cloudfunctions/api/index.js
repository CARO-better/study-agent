'use strict';
const { randomUUID } = require('node:crypto');
const { fail, resultError } = require('./core/errors');
const { handleRecords, isObject } = require('./core/records');
const { handleProviders } = require('./core/provider-settings');
const { handleExtraction } = require('./core/extraction');
const { handleUpload } = require('./core/upload');
const { handleImports } = require('./core/imports');
const { handleResources } = require('./core/resources');
const { handlePlanner } = require('./core/plan-api');
const { handleSnapshots } = require('./core/snapshots');
const { handleAiChat } = require('./core/ai-chat');
const { createCloudBaseRepository } = require('./adapters/repository');
// Order matters: the specific imports actions are matched before the generic prefix.
const ROUTES = [
  [action => action.startsWith('sync.'), handleSnapshots],
  [action => action.startsWith('ai.'), handleAiChat],
  [action => action.startsWith('providers.'), handleProviders],
  [action => ['imports.prepareUpload', 'imports.upload'].includes(action), handleUpload],
  [action => ['imports.extractText', 'imports.extractScreenshot'].includes(action), handleExtraction],
  [action => action.startsWith('imports.'), handleImports],
  [action => action.startsWith('resources.'), handleResources],
  [action => action.startsWith('plan.') || action === 'profiles.setAvailability', handlePlanner]
];
const route = action => ROUTES.find(([matches]) => matches(action))?.[1] || handleRecords;
async function handleAction({ owner, action, payload = {} } = {}, deps = {}) {
  try {
    if (typeof owner !== 'string' || !owner.trim()) fail('UNAUTHENTICATED');
    if (typeof action !== 'string' || action.length > 100 || !isObject(payload)) fail('VALIDATION');
    // 诊断动作：不碰数据库、不碰仓储，只回报运行时事实。
    // 用来把「云函数本身跑不起来」和「数据库/集合有问题」这两种 INTERNAL 分开。
    if (action === 'system.ping') {
      return {
        ok: true,
        data: {
          node: typeof process !== 'undefined' ? process.version : 'unknown',
          structuredClone: typeof structuredClone,
          env: (typeof process !== 'undefined' && (process.env.TCB_ENV || process.env.SCF_NAMESPACE)) || '',
          runtimeReady: typeof structuredClone === 'function'
        }
      };
    }
    const dependencies = { now: () => new Date().toISOString(), newId: randomUUID, ...deps };
    const data = await route(action)({ owner, action, payload }, dependencies);
    return { ok: true, data };
  } catch (error) { return resultError(error); }
}
function createHandler(deps) {
  return async function handler(event = {}) {
    try {
      const { OPENID } = deps.getWXContext() || {};
      return await handleAction({ owner: OPENID, action: event.action, payload: event.payload }, deps);
    } catch (error) { return resultError(error); }
  };
}
let productionHandler;
function createProductionHandler(cloud) {
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createHandler({ getWXContext: () => cloud.getWXContext(), repository: createCloudBaseRepository(cloud.database({ throwOnNotFound: false })), cloud, cloudEnvId: process.env.STUDY_CLOUD_ENV_ID, cloudFilePrefix: process.env.STUDY_CLOUD_FILE_PREFIX, masterKey: process.env.STUDY_MASTER_KEY, ocrSecretId: process.env.STUDY_OCR_SECRET_ID, ocrSecretKey: process.env.STUDY_OCR_SECRET_KEY, ocrRegion: process.env.STUDY_OCR_REGION, ocrDailyLimit: Number(process.env.STUDY_OCR_DAILY_LIMIT) || undefined, biliCookie: process.env.STUDY_BILI_COOKIE || undefined, dailyCallLimit: Number(process.env.STUDY_DAILY_CALL_LIMIT) || undefined });
}
// 启动自检：把「初始化链断在哪一步」暴露出来。
// 普通的业务动作一旦在 createProductionHandler 阶段崩掉，会被压成 INTERNAL，看不出原因；
// 这个动作不依赖任何已初始化的东西，只逐级 try 一遍并回报结果。
function bootReport() {
  const report = {
    node: typeof process !== 'undefined' ? process.version : 'unknown',
    structuredClone: typeof structuredClone,
    runtimeReady: typeof structuredClone === 'function',
    env: (typeof process !== 'undefined' && (process.env.TCB_ENV || process.env.SCF_NAMESPACE)) || '',
    steps: [],
    allReady: false
  };
  const step = (name, fn) => {
    try {
      const value = fn();
      report.steps.push(`${name}: ok`);
      return value;
    } catch (error) {
      report.steps.push(`${name}: FAIL`);
      return null;
    }
  };
  const sdk = step('require wx-server-sdk', () => require('wx-server-sdk'));
  if (!sdk) return { ok: true, data: report };
  report.sdkVersion = (() => { try { return require('wx-server-sdk/package.json').version; } catch { return 'unknown'; } })();
  step('cloud.init', () => sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }));
  const db = step('database()', () => sdk.database({ throwOnNotFound: false }));
  if (!db) return { ok: true, data: report };
  step('repository', () => createCloudBaseRepository(db));
  report.allReady = !report.steps.some(line => line.includes('FAIL'));
  return { ok: true, data: report };
}

async function main(event) {
  // 诊断动作必须抢在一切初始化之前处理，否则初始化失败时它自己也调不到。
  if (event && event.action === 'system.ping') return bootReport();
  try {
    if (!productionHandler) {
      productionHandler = createProductionHandler(require('wx-server-sdk'));
    }
    return await productionHandler(event);
  } catch (error) { return resultError(error); }
}
module.exports = { main, handleAction, createHandler, createProductionHandler };
