'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const bus=require('../miniprogram/lib/surface-bus');

test('a custom host receives menu requests and resolves the selected action',async()=>{
  bus.reset();
  let received=null;
  bus.subscribe(request=>{received=request;bus.settle(request.id,{confirm:true,index:1,action:request.items[1]});});
  const result=await bus.menu({title:'操作',items:['编辑','删除'],anchorSelector:'#task-more-0'});
  assert.equal(received.type,'menu');
  assert.deepEqual(result,{confirm:true,index:1,action:'删除'});
});

test('without a host the bus falls back to native modal semantics',async()=>{
  bus.reset();
  const dialogs=[];
  global.wx={showModal(options){dialogs.push(options);options.success({confirm:true,content:'2026-01-01,2026-02-01,4'});},showActionSheet(){}};
  const result=await bus.prompt({title:'填日期',content:'x'});
  assert.equal(dialogs[0].editable,true);
  assert.equal(result.confirm,true);
  assert.equal(result.content,'2026-01-01,2026-02-01,4');
});

test('fallback confirmations honor showCancel false',async()=>{
  bus.reset();
  let options=null;
  global.wx={showModal(value){options=value;value.success({confirm:true});},showActionSheet(){}};
  await bus.confirm({title:'只看结果',content:'ok',showCancel:false});
  assert.equal(options.showCancel,false);
});

test('queued requests preserve order behind the active host',async()=>{
  bus.reset();
  const order=[];
  let release=null;
  bus.subscribe(request=>{
    order.push(request.id);
    if(request.id===1)release=()=>bus.settle(request.id,{confirm:true});
    else bus.settle(request.id,{confirm:true});
  });
  const first=bus.confirm({title:'one'});
  const second=bus.confirm({title:'two'});
  assert.deepEqual(order,[1]);
  release();
  await Promise.all([first,second]);
  assert.deepEqual(order,[1,2]);
});

test('detaching the last host resolves queued requests instead of hanging',async()=>{
  bus.reset();
  const unsubscribe=bus.subscribe(()=>{});
  const current=bus.confirm({title:'current'});
  const queued=bus.confirm({title:'queued'});
  unsubscribe();
  const results=await Promise.all([current,queued]);
  assert.deepEqual(results.map(result=>result.confirm),[false,false]);
});

test('reset resolves any in-flight request',async()=>{
  bus.reset();
  bus.subscribe(()=>{});
  const request=bus.menu({title:'stale',items:['a','b']});
  bus.reset();
  assert.equal((await request).confirm,false);
});
