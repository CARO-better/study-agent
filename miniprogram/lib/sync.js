'use strict';
const cloud = require('./cloud');
const STORE_KEY = 'study_trial_v1';
const STAMP_KEY = 'study_sync_stamp_v1';
const META_KEY = 'study_sync_meta_v2';
const RECOVERY_KEY = 'study_recovery_v1';
const PUSH_DELAY = 800;
let timer = null, pushing = null, pulling = null;
const listeners = new Set();
const clone = value => JSON.parse(JSON.stringify(value));
function read(key) { return wx.getStorageSync(key); }
function meta() { return Object.assign({revision:0,generation:0,dirty:false,initialized:false,state:'local',updatedAt:null},read(META_KEY)||{}); }
function writeMeta(patch) {
  const next=Object.assign(meta(),patch);wx.setStorageSync(META_KEY,next);
  for(const fn of listeners) fn(status());
  return next;
}
function status() {
  const value=meta();
  const labels={local:'仅本机保存',pending:'等待同步',syncing:'正在同步',synced:'已同步云端',error:'同步失败，已保留本机数据',conflict:'存在云端冲突，请选择保留版本'};
  return Object.assign({},value,{label:labels[value.state]||labels.local});
}
function subscribe(fn) {listeners.add(fn);fn(status());return ()=>listeners.delete(fn);}
function deviceTag() {try{return String(wx.getSystemInfoSync().model||'unknown').slice(0,32);}catch(_){return 'unknown';}}
function localStamp() {return read(STAMP_KEY)||'';}
function markLocal(stamp) {const value=stamp||new Date().toISOString();wx.setStorageSync(STAMP_KEY,value);return value;}
function recover(store,reason) {
  if(!store)return;const old=read(RECOVERY_KEY);
  wx.setStorageSync(RECOVERY_KEY,[{savedAt:new Date().toISOString(),reason,store:clone(store)}].concat(Array.isArray(old)?old:[]).slice(0,3));
}
function save(store) {wx.setStorageSync(STORE_KEY,clone(store));schedule();return store;}
function schedule() {
  const current=meta();writeMeta({dirty:true,generation:current.generation+1,state:cloud.available()?'pending':'local',error:null});markLocal();
  if(timer)clearTimeout(timer);
  if(cloud.available())timer=setTimeout(()=>{timer=null;flush();},PUSH_DELAY);
}
async function pull() {
  const data=await cloud.call('sync.pull',{});return {store:data.payload,revision:data.revision||0,updatedAt:data.updatedAt||null};
}
function applyRemote(remote) {
  recover(read(STORE_KEY),'before-cloud-restore');wx.setStorageSync(STORE_KEY,clone(remote.store));
  writeMeta({revision:remote.revision,updatedAt:remote.updatedAt,dirty:false,initialized:true,state:'synced',error:null});markLocal(remote.updatedAt);
  return {store:clone(remote.store),restored:true};
}
async function reconcile() {
  if(!cloud.available())return {store:read(STORE_KEY),restored:false};
  if(pulling)return pulling;
  pulling=(async()=>{
    const started=meta(),remote=await pull(),current=meta(),local=read(STORE_KEY);
    const hasLocal=local&&['courses','tasks','availability','fixedBlocks','blocks'].some(k=>Array.isArray(local[k])&&local[k].length);
    const changed=current.generation!==started.generation||current.dirty;
    if(!remote.store){
      writeMeta({initialized:true,revision:0});
      if(hasLocal||changed)writeMeta({dirty:true,state:'pending'});else writeMeta({state:'synced'});
      return {store:local,restored:false};
    }
    if(JSON.stringify(local)===JSON.stringify(remote.store)){
      writeMeta({initialized:true,revision:remote.revision,updatedAt:remote.updatedAt,dirty:false,state:'synced',error:null});return {store:local,restored:false};
    }
    if(changed||(hasLocal&&!started.initialized)){
      if(remote.revision!==current.revision||!started.initialized)writeMeta({state:'conflict',error:'CONFLICT'});
      return {store:local,restored:false};
    }
    if(!hasLocal||remote.revision>current.revision)return applyRemote(remote);
    return {store:local,restored:false};
  })().catch(error=>{writeMeta({state:'error',error:error.code||'NETWORK'});return {store:read(STORE_KEY),restored:false};}).finally(()=>{pulling=null;});
  return pulling;
}
async function pushNow(store) {save(store);return flush();}
async function flush() {
  if(timer){clearTimeout(timer);timer=null;}
  if(!cloud.available())return null;
  if(pushing)return pushing;
  pushing=(async()=>{
    if(!meta().initialized)await reconcile();
    while(meta().dirty){
      const before=meta();if(before.state==='conflict')return null;
      const store=read(STORE_KEY);if(!store)return null;
      writeMeta({state:'syncing'});
      try{
        const result=await cloud.call('sync.push',{store:clone(store),device:deviceTag(),expectedRevision:before.revision});
        const latest=meta(),clean=latest.generation===before.generation;
        writeMeta({initialized:true,revision:result.revision,updatedAt:result.updatedAt,dirty:!clean,state:clean?'synced':'pending',error:null});markLocal(result.updatedAt);
      }catch(error){writeMeta({dirty:true,state:error.code==='CONFLICT'?'conflict':'error',error:error.code||'NETWORK'});return null;}
    }
    return status();
  })().finally(()=>{pushing=null;});
  return pushing;
}
async function restoreRemote() {
  const started=meta();
  if(pushing)await pushing;const remote=await pull();
  if(!remote.store)throw Error('云端还没有完整快照，请先在原设备同步');
  if(meta().generation!==started.generation)throw Object.assign(Error('恢复期间本机数据发生变化，已保留最新改动，请重新确认恢复'),{code:'LOCAL_CHANGED'});
  if(timer){clearTimeout(timer);timer=null;}return applyRemote(remote);
}
async function overwriteRemote() {
  if(pushing)await pushing;const remote=await pull();recover(remote.store,'before-explicit-cloud-overwrite');
  writeMeta({initialized:true,revision:remote.revision,dirty:true,state:'pending'});return flush();
}
async function generatePlan() {
  await flush();const before=meta();
  if(before.dirty||before.state==='conflict'||before.state==='error')throw Object.assign(Error('请先解决同步问题，再生成云端计划'),{code:before.error||'CONFLICT'});
  const result=await cloud.call('sync.plan',{store:clone(read(STORE_KEY)),expectedRevision:before.revision});
  if(meta().generation!==before.generation){
    writeMeta({revision:result.revision,dirty:true,state:'pending'});await flush();throw Error('生成期间数据发生变化，已保留最新改动，请重新生成');
  }
  wx.setStorageSync(STORE_KEY,result.store);writeMeta({revision:result.revision,updatedAt:result.updatedAt,dirty:false,initialized:true,state:'synced'});
  return result.store;
}
function decide(remoteStamp,stamp,empty) {return remoteStamp&&(empty||!stamp||remoteStamp>stamp)?'remote':'local';}
module.exports={save,schedule,flush,pull,pushNow,reconcile,restoreRemote,overwriteRemote,generatePlan,recover,status,subscribe,localStamp,markLocal,deviceTag,decide,STORE_KEY,STAMP_KEY,META_KEY,RECOVERY_KEY,PUSH_DELAY};
