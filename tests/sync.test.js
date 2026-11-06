'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../cloudfunctions/api');
const { createMemoryRepository } = require('../cloudfunctions/api/adapters/repository');
const blank = () => ({courses:[],tasks:[],availability:[],blocks:[],unscheduled:[],previous:null});
function backend() {
  let n = 0;
  const deps = {repository:createMemoryRepository(),now:()=>new Date(Date.UTC(2026,10,6,8,0,n++)).toISOString()};
  return (action,payload={}) => api.handleAction({owner:'sync-user',action,payload},deps);
}
function client(call, storage={}) {
  global.wx = {getStorageSync:key=>storage[key],setStorageSync:(key,value)=>{storage[key]=structuredClone(value);},getSystemInfoSync:()=>({model:'test'}),
    cloud:{callFunction:async ({data})=>({result:await call(data.action,data.payload)})}};
  const path = require.resolve('../miniprogram/lib/sync'); delete require.cache[path];
  return {sync:require(path),storage};
}
test('snapshot writes reject stale revisions instead of overwriting a newer device',async()=>{
  const call=backend();
  assert.equal((await call('sync.push',{store:blank(),expectedRevision:0})).ok,true);
  const stale=await call('sync.push',{store:{...blank(),tasks:[{id:'lost',title:'stale'}]},expectedRevision:0});
  assert.equal(stale.error.code,'CONFLICT');
  assert.deepEqual((await call('sync.pull')).data.payload.tasks,[]);
});
test('snapshot limits count UTF-8 bytes and reject malformed stores',async()=>{
  const call=backend();
  for(const store of [{hello:'world'},{...blank(),tasks:[{id:'huge',title:'中'.repeat(190000)}]}]){
    const r=await call('sync.push',{store,expectedRevision:0});assert.equal(r.ok,false);assert.equal(r.error.code,'VALIDATION');
  }
});
test('a failed push stays dirty across restart and can be retried',async()=>{
  const call=backend();let offline=true;
  const proxy=async (a,p)=>{if(offline&&a==='sync.push')throw Error('offline');return call(a,p);};
  let {sync,storage}=client(proxy);
  sync.save({...blank(),tasks:[{id:'t1',title:'keep me'}]});
  await sync.flush();
  assert.equal(sync.status().state,'error');
  offline=false;({sync}=client(proxy,storage));
  await sync.flush();
  assert.equal(sync.status().state,'synced');
  assert.equal((await call('sync.pull')).data.payload.tasks[0].title,'keep me');
});
test('pull completion cannot overwrite data edited after pull started, even on an empty app',async()=>{
  const call=backend();await call('sync.push',{store:{...blank(),tasks:[{id:'remote',title:'old'}]},expectedRevision:0});
  let release;const gate=new Promise(r=>{release=r;});
  const {sync,storage}=client(async (a,p)=>{if(a==='sync.pull')await gate;return call(a,p);});
  const pulling=sync.reconcile();
  sync.save({...blank(),tasks:[{id:'local',title:'new edit'}]});
  release();await pulling;
  assert.equal(storage.study_trial_v1.tasks[0].id,'local');
  assert.equal(sync.status().state,'conflict');
  await sync.flush();
});
test('restore returns the full snapshot and saves a local recovery copy',async()=>{
  const call=backend();const remote={...blank(),availability:[{id:'a'}],blocks:[{id:'b'}]};
  await call('sync.push',{store:remote,expectedRevision:0});
  const {sync,storage}=client(call,{study_trial_v1:{...blank(),tasks:[{id:'local',title:'backup'}]}});
  await sync.restoreRemote();
  assert.deepEqual(storage.study_trial_v1,remote);
  assert.equal(storage[sync.RECOVERY_KEY][0].store.tasks[0].title,'backup');
});
test('pushes are serialized and later local edits remain pending until acknowledged',async()=>{
  const call=backend();let release;const gate=new Promise(r=>{release=r;});let first=true;
  const {sync}=client(async(a,p)=>{if(a==='sync.push'&&first){first=false;await gate;}return call(a,p);});
  sync.save({...blank(),tasks:[{id:'t',title:'first'}]});const flushing=sync.flush();
  await new Promise(r=>setImmediate(r));
  sync.save({...blank(),tasks:[{id:'t',title:'second'}]});release();await flushing;await sync.flush();
  assert.equal((await call('sync.pull')).data.payload.tasks[0].title,'second');
  assert.equal(sync.status().state,'synced');
});
