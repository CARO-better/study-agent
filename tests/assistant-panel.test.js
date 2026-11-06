'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

function panel(call) {
  const storage = {study_trial_v1:{courses:[],tasks:[],availability:[],blocks:[],unscheduled:[],previous:null},study_sync_meta_v2:{initialized:true,dirty:false,state:'synced',revision:1,generation:0}};
  let definition;
  global.wx = {getStorageSync:key=>storage[key],setStorageSync:(key,value)=>{storage[key]=structuredClone(value);},
    getSystemInfoSync:()=>({model:'test',statusBarHeight:20}),showToast(){},showModal(options){options.success({confirm:true});},
    cloud:{callFunction:async({data})=>({result:await call(data.action,data.payload)})}};
  global.Component = value => {definition=value;};
  for(const file of ['../miniprogram/lib/sync','../miniprogram/lib/appearance','../miniprogram/components/assistant-panel/index'])delete require.cache[require.resolve(file)];
  require('../miniprogram/components/assistant-panel/index');
  const events=[];
  const instance={...definition.methods,data:structuredClone(definition.data),properties:{settingsOpen:false},
    setData(patch){assert.equal(Boolean(this.disposed),false,'a detached panel must not update its view');Object.assign(this.data,patch);},
    triggerEvent(name){events.push(name);}};
  return {instance,definition,storage,events};
}

test('closing the floating assistant blocks a delayed tool call and its stale view update',async()=>{
  let release, chats=0; const actions=[];
  const gate=new Promise(resolve=>{release=resolve;});
  const h=panel(async(action)=>{
    actions.push(action);
    if(action==='ai.chat'){
      if(chats++===0){await gate;return {ok:true,data:{message:{role:'assistant',content:'',tool_calls:[{id:'late',type:'function',function:{name:'create_task',arguments:'{"title":"late task"}'}}]}}};}
      return {ok:true,data:{message:{role:'assistant',content:'cancelled'}}};
    }
    throw Error('unexpected cloud write');
  });
  const p=h.instance;p.store=structuredClone(h.storage.study_trial_v1);p.history=[];p.data.hasKey=true;p.data.input='plan';
  const before=JSON.stringify(h.storage);
  const sending=p.send();await new Promise(resolve=>setImmediate(resolve));
  h.definition.lifetimes.detached.call(p);release();await sending;
  assert.equal(JSON.stringify(h.storage),before);
  assert.deepEqual(actions,['ai.chat','ai.chat']);
});

test('a provider lookup completing after the panel closes does not update storage or the detached view',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const h=panel(async(action)=>{assert.equal(action,'providers.get');await gate;return {ok:true,data:{url:'https://example.com/chat/completions',model:'test',keyMasked:'••••'}};});
  const p=h.instance;
  const pending=p.checkCloudProvider();
  h.definition.lifetimes.detached.call(p);release();await pending;
  assert.equal(h.storage.study_ai_v1,undefined);
});

test('the compatibility AI screen has a working close action when opened as the root page',()=>{
  const h=panel(async()=>({ok:true,data:null})),calls=[];
  global.getCurrentPages=()=>[{}];
  global.wx.navigateBack=()=>calls.push('back');global.wx.reLaunch=options=>calls.push(options.url);
  h.instance.back();assert.deepEqual(calls,['/pages/today/index']);
});

test('oversized complete image requests keep the attachment and input without calling the cloud',async()=>{
 let called=false;const h=panel(async()=>{called=true;throw Error('must not send');});
 const p=h.instance;p.store=h.storage.study_trial_v1;p.history=[];p.data.hasKey=true;p.data.input='保留';p.data.pendingImage='data:image/jpeg;base64,'+'A'.repeat(100000);
 const image=p.data.pendingImage;await p.send();
 assert.equal(called,false);assert.equal(p.data.pendingImage,image);assert.equal(p.data.input,'保留');assert.equal(p.data.sending,false);
});
