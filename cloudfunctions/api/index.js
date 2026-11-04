'use strict';
const { randomUUID } = require('node:crypto');
const { fail, resultError } = require('./core/errors');
const { handleRecords, isObject } = require('./core/records');
const { handleImports } = require('./core/imports');
const { createCloudBaseRepository } = require('./adapters/repository');
async function handleAction({ owner, action, payload = {} } = {}, deps = {}) {
  try {
    if (typeof owner !== 'string' || !owner.trim()) fail('UNAUTHENTICATED');
    if (typeof action !== 'string' || action.length > 100 || !isObject(payload)) fail('VALIDATION');
    const dependencies = { now: () => new Date().toISOString(), newId: randomUUID, ...deps };
    const data = await (action.startsWith('imports.') ? handleImports : handleRecords)({ owner, action, payload }, dependencies);
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
  return createHandler({ getWXContext: () => cloud.getWXContext(), repository: createCloudBaseRepository(cloud.database({ throwOnNotFound: false })) });
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
