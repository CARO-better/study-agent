'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const now='2026-11-06T08:00:00.000Z';
const base=()=>({courses:[],tasks:[{id:'t1',title:'复习',status:'open',remainingMinutes:60,version:1,priority:'high'}],availability:[{start:'2026-11-06T10:00:00.000Z',end:'2026-11-06T13:00:00.000Z'}],blocks:[],unscheduled:[],previous:null});
test('study planner is generated from the server source and makes a cloud-compatible full store',()=>{
  const planning=require('../cloudfunctions/api/core/study-plan');
  const result=planning.generate(base(),now);
  assert.equal(result.blocks.length,1);assert.equal(result.planVersion,1);assert.equal(result.previous.toVersion,1);
  const fs=require('node:fs');
  for(const file of ['planner.js','revisions.js','study-plan.js'])assert.equal(fs.readFileSync(require.resolve('../miniprogram/lib/'+file),'utf8'),fs.readFileSync(require.resolve('../cloudfunctions/api/core/'+file),'utf8'));
});
test('progress replanning removes finished work and undo cannot resurrect completed tasks',()=>{
  const p=require('../cloudfunctions/api/core/study-plan');let store=p.generate(base(),now);
  store.tasks[0]={...store.tasks[0],status:'completed',version:2};
  store=p.autoReplan(store,now);assert.equal(store.blocks.length,0);
  const undone=p.undo(store,now);assert.equal(undone.ok,false);assert.equal(undone.store.tasks[0].status,'completed');
});
test('locked blocks are preserved and incompatible progress produces an explicit attention state',()=>{
  const p=require('../cloudfunctions/api/core/study-plan');let store=p.generate(base(),now);
  store.blocks[0].locked=true;store.tasks[0].remainingMinutes=30;store.tasks[0].version++;
  const result=p.autoReplan(store,now);assert.equal(result.planStatus,'needs_attention');assert.deepEqual(result.blocks,store.blocks);
});
test('undo refuses to restore a plan after the user changes available time',()=>{
  const p=require('../cloudfunctions/api/core/study-plan');let store=p.generate(base(),now);
  store.availability=[];assert.equal(p.undo(store,now).ok,false);
});
test('cloud planning uses snapshot IDs and does not depend on old record migration',async()=>{
  const api=require('../cloudfunctions/api');const {createMemoryRepository}=require('../cloudfunctions/api/adapters/repository');
  const deps={repository:createMemoryRepository(),now:()=>now};
  const result=await api.handleAction({owner:'alice',action:'sync.plan',payload:{store:base(),expectedRevision:0}},deps);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.store.tasks[0].id,'t1');
  assert.equal(result.data.store.blocks.length,1);assert.equal(result.data.revision,1);
  const pulled=await api.handleAction({owner:'alice',action:'sync.pull'},deps);assert.deepEqual(pulled.data.payload,result.data.store);
});
test('equal-deadline plans consider course importance and avoid dated fixed classes',()=>{
  const p=require('../cloudfunctions/api/core/study-plan'),store=base();
  store.courses=[{id:'low',importance:'low',mastery:'high'},{id:'high',importance:'high',mastery:'low'}];
  store.tasks=[{id:'a',courseId:'low',status:'open',remainingMinutes:30,version:1},{id:'b',courseId:'high',status:'open',remainingMinutes:30,version:1}];
  store.fixedBlocks=[{start:'2026-11-06T10:00:00Z',end:'2026-11-06T11:00:00Z'}];
  const result=p.generate(store,now);assert.equal(result.blocks[0].taskId,'b');assert.equal(result.blocks[0].start,'2026-11-06T11:00:00.000Z');
});
test('undo after an availability change cannot restore blocks outside the current free time',()=>{
  const p=require('../cloudfunctions/api/core/study-plan');let store=p.generate(base(),now);
  store.availability=[];store=p.autoReplan(store,now);
  assert.equal(p.undo(store,now).ok,false);
});
test('undo after a new class is added cannot restore an overlapping old block',()=>{
  const p=require('../cloudfunctions/api/core/study-plan');let store=p.generate(base(),now);
  store.fixedBlocks=[{start:'2026-11-06T10:00:00Z',end:'2026-11-06T11:00:00Z'}];store=p.autoReplan(store,now);
  assert.equal(p.undo(store,now).ok,false);
});
