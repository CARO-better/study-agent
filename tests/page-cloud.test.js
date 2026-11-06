'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const empty=()=>({courses:[],tasks:[],availability:[],blocks:[],unscheduled:[],previous:null});
function load(pageName,storage,call){
 global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{storage[k]=structuredClone(v);},showToast(){},showLoading(){},hideLoading(){},showModal(o){if(o.success)o.success({confirm:true});},getSystemInfoSync:()=>({model:'test'}),cloud:{callFunction:async({data})=>({result:await call(data.action,data.payload)})}};
 let definition;global.Page=value=>{definition=value;};
 for(const file of ['../miniprogram/lib/sync','../miniprogram/pages/'+pageName+'/index'])delete require.cache[require.resolve(file)];
 require('../miniprogram/pages/'+pageName+'/index');
 const instance={...definition,data:structuredClone(definition.data),setData(patch){for(const [key,value]of Object.entries(patch)){if(key.includes('.')){const [a,b]=key.split('.');this.data[a][b]=value;}else this.data[key]=value;}}};
 return {page:instance,sync:require('../miniprogram/lib/sync')};
}
test('AI confirmed task creation saves through the cloud snapshot queue',async()=>{
 const storage={study_trial_v1:empty()};let chats=0,uploaded;
 const {page,sync}=load('ai',storage,async(action,payload)=>{
  if(action==='ai.chat')return {ok:true,data:{message:chats++?{role:'assistant',content:'已添加'}:{role:'assistant',content:'',tool_calls:[{id:'c1',type:'function',function:{name:'create_task',arguments:'{"title":"线代作业"}'}}]}}};
  if(action==='sync.pull')return {ok:true,data:{payload:null,revision:0}};
  if(action==='sync.push'){uploaded=payload.store;return {ok:true,data:{revision:1,updatedAt:'2026-11-06T08:00:00Z'}};}
  return {ok:true,data:null};
 });
 page.store=empty();page.history=[];page.data.input='加个线代作业';page.data.hasKey=true;
 await page.send();await sync.flush();assert.equal(uploaded.tasks[0].title,'线代作业');assert.equal(uploaded.tasks[0].dueAt,'');assert.equal(sync.status().state,'synced');
});
test('AI settings page never leaves a new key on disk after successful cloud save',async()=>{
 const storage={};const {page}=load('ai',storage,async()=>({ok:true,data:{keyMasked:'••••'}}));
 page.data.settings={url:'https://example.com/chat/completions',model:'test',apiKey:'FAKE_PAGE_KEY'};
 await page.saveSettings();assert.equal(storage.study_ai_v1.apiKey,'');assert.equal(page.data.settings.apiKey,'');assert.equal(page.data.hasKey,true);
});

test('cancelling AI creation preserves storage and returns cancellation to the model',async()=>{
 for(const name of ['create_task','create_course']){
  const storage={study_trial_v1:{...empty(),tasks:[{id:'existing',title:'已有任务',status:'open'}]},study_sync_meta_v2:{initialized:true,dirty:false,revision:1,generation:0,state:'synced'}};
  const before=structuredClone(storage),actions=[];let chats=0,receipt;
  const {page,sync}=load('ai',storage,async(action,payload)=>{
   actions.push(action);
   assert.equal(action,'ai.chat','cancellation must not trigger a cloud data write');
   if(chats++===0)return {ok:true,data:{message:{role:'assistant',content:'',tool_calls:[{id:'cancel',type:'function',function:{name,arguments:JSON.stringify({title:'新任务',name:'新课程'})}}]}}};
   receipt=payload.messages.find(message=>message.role==='tool');
   return {ok:true,data:{message:{role:'assistant',content:'已取消保存'}}};
  });
  global.wx.showModal=options=>options.success({confirm:false,cancel:true});
  page.store=structuredClone(storage.study_trial_v1);page.history=[];page.data.input='整理并添加';page.data.hasKey=true;
  await page.send();await sync.flush();
  assert.deepEqual(storage,before);
  assert.deepEqual(actions,['ai.chat','ai.chat']);
  assert.equal(JSON.parse(receipt.content).ok,false);
  assert.match(JSON.parse(receipt.content).reason,/取消/);
  assert.equal(page.data.sending,false);
 }
});
test('manual cloud restoration uses full snapshots rather than the obsolete record lists',async()=>{
 const store={...empty(),availability:[{start:'2026-11-06T10:00:00Z',end:'2026-11-06T12:00:00Z'}],blocks:[{taskId:'t1',start:'2026-11-06T10:00:00Z',end:'2026-11-06T11:00:00Z'}],tasks:[{id:'t1',title:'复习',status:'open'}]};
 const storage={study_trial_v1:empty()},actions=[];
 const {page}=load('today',storage,async(action)=>{actions.push(action);return {ok:true,data:{payload:store,revision:4,updatedAt:'2026-11-06T08:00:00Z'}};});
 await page.restoreFromCloud();assert.deepEqual(storage.study_trial_v1,store);assert.deepEqual(actions,['sync.pull']);
});
test('a delayed AI response preserves tasks saved after the request started',async()=>{
 const storage={study_trial_v1:empty()};let chats=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const {page,sync}=load('ai',storage,async(action,payload)=>{
  if(action==='ai.chat'){if(chats++===0){await gate;return {ok:true,data:{message:{role:'assistant',content:'',tool_calls:[{id:'late',type:'function',function:{name:'create_task',arguments:'{"title":"AI任务"}'}}]}}};}return {ok:true,data:{message:{role:'assistant',content:'已完成'}}};}
  if(action==='sync.pull')return {ok:true,data:{payload:null,revision:0}};
  if(action==='sync.push')return {ok:true,data:{revision:1,updatedAt:'2026-11-06T08:00:00Z'}};
 });
 page.store=empty();page.history=[];page.data.input='新增任务';page.data.hasKey=true;
 const sending=page.send();await new Promise(resolve=>setImmediate(resolve));
 sync.save({...empty(),tasks:[{id:'manual',title:'手动新增',status:'open'}]});
 release();await sending;await sync.flush();
 assert.deepEqual(storage.study_trial_v1.tasks.map(t=>t.title),['手动新增','AI任务']);
});
