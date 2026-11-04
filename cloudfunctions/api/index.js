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
const { createCloudBaseRepository } = require('./adapters/repository');
// Order matters: the specific imports actions are matched before the generic prefix.
const ROUTES = [
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
async function main(event) {
  try {
    if (!productionHandler) {
      productionHandler = createProductionHandler(require('wx-server-sdk'));
    }
    return await productionHandler(event);
  } catch (error) { return resultError(error); }
}
module.exports = { main, handleAction, createHandler, createProductionHandler };
