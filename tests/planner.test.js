'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../cloudfunctions/api');
const { createMemoryRepository } = require('../cloudfunctions/api/adapters/repository');
const fs = require('node:fs');
test('planner schedules around fixed blocks and reports missing availability', () => {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '../cloudfunctions/api/core/planner.js')), 'planner implementation is missing');
  const { buildPlan } = require('../cloudfunctions/api/core/planner');
  const tasks = [{ id: 'a', version: 1, status: 'pending', remainingMinutes: 120, dueAt: '2026-11-04', priority: 'high' }];
  const now = '2026-11-04T00:00:00Z';
  const empty = buildPlan({ tasks, availability: [], fixedBlocks: [], now });
  assert.equal(empty.unscheduled[0].taskId, 'a');
  const p = buildPlan({ tasks, availability: [{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}], fixedBlocks: [{start:'2026-11-04T01:00:00Z',end:'2026-11-04T02:00:00Z'}], now });
  assert.ok(p.blocks.length); assert.ok(p.blocks.every(b => Date.parse(b.end)<=Date.parse('2026-11-04T01:00:00Z') || Date.parse(b.start)>=Date.parse('2026-11-04T02:00:00Z')));
});
test('plan API protects users and uses versions', async () => {
  let i=0; const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`id${++i}`};
  const call=(owner,action,payload={})=>api.handleAction({owner,action,payload},deps);
  const profile=await call('a','profiles.create',{record:{displayName:'A'}}); assert.equal(profile.ok,true);
  const saved=await call('a','profiles.setAvailability',{id:profile.data.id,expectedVersion:1,availability:[]}); assert.equal(saved.ok,true,JSON.stringify(saved));
  const plan=await call('a','plan.generate',{expectedVersion:0}); assert.equal(plan.ok,true,JSON.stringify(plan));
  const stale=await call('a','plan.generate',{expectedVersion:0}); assert.equal(stale.error.code,'CONFLICT');
  const other=await call('b','plan.get'); assert.equal(other.ok,true); assert.equal(other.data,null);
});
test('replan preserves locked blocks and undo refuses stale or completed task restoration', () => {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '../cloudfunctions/api/core/revisions.js')), 'revision implementation is missing');
  const { replan, undoRevision } = require('../cloudfunctions/api/core/revisions');
  const state = { version: 1, now:'2026-11-04T00:00:00Z', tasks:[{id:'a',version:1,status:'pending',remainingMinutes:60}], availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}], blocks:[{id:'manual',taskId:'a',taskVersion:1,start:'2026-11-04T00:00:00Z',end:'2026-11-04T01:00:00Z',locked:true}] };
  const result=replan(state,{id:'rev',taskIds:['a']}); assert.ok(result.plan.blocks.some(b=>b.id==='manual'));
  assert.ok(undoRevision({...state,version:3},result.revision,2).conflicts.length);
  const done=undoRevision({...result.plan,version:2,tasks:[{id:'a',version:2,status:'completed'}]},result.revision,2);
  assert.ok(done.conflicts.length);
});
test('scheduled courses require explicit period mapping before generation', async () => {
  let i=0; const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`c${++i}`}; const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps);
  const p=(await call('profiles.create',{record:{displayName:'A'}})).data;
  const s=(await call('semesters.create',{record:{name:'S',startDate:'2026-11-02',endDate:'2026-12-30',teachingWeeks:8}})).data;
  await call('courses.create',{record:{name:'C',semesterId:s.id,schedule:[{weekday:3,weeks:[1],periods:[1]}]}});
  await call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}]});
  const result=await call('plan.generate',{expectedVersion:0}); assert.equal(result.ok,true); assert.ok(result.data.configurationNeeded.includes('termPeriodTimes')); assert.equal((await call('plan.get')).data,null);
});
test('mapped class is avoided, progress replan updates task, undo preserves completion and manual edits', async () => {
  let i=0; const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`z${++i}`}; const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps); const ok=async p=>{const r=await p; assert.equal(r.ok,true,JSON.stringify(r)); return r.data;};
  const profile=await ok(call('profiles.create',{record:{displayName:'A'}})); const semester=await ok(call('semesters.create',{record:{name:'S',startDate:'2026-11-02',endDate:'2026-12-30',teachingWeeks:8}}));
  await ok(call('courses.create',{record:{name:'C',semesterId:semester.id,schedule:[{weekday:3,weeks:[1],periods:[1]}]}}));
  await ok(call('profiles.setAvailability',{id:profile.id,expectedVersion:1,availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}],termPeriodTimes:{1:{start:'09:00',end:'10:00'}}}));
  const task=await ok(call('tasks.create',{record:{title:'T',remainingMinutes:120}})); const first=await ok(call('plan.generate',{expectedVersion:0}));
  assert.ok(first.plan.blocks.every(b=>Date.parse(b.end)<=Date.parse('2026-11-04T01:00:00Z')||Date.parse(b.start)>=Date.parse('2026-11-04T02:00:00Z')));
  const progress=await ok(call('plan.progress',{expectedVersion:1,changes:[{id:task.id,expectedVersion:1,remainingMinutes:30,completed:true}]}));
  assert.equal((await ok(call('tasks.get',{id:task.id}))).status,'completed');
  const undo=await ok(call('plan.undo',{expectedVersion:2,revisionId:progress.revision.id})); assert.ok(undo.conflicts.length); assert.equal((await ok(call('tasks.get',{id:task.id}))).status,'completed');
});
test('progress replans using transaction writes even when scans see pretransaction snapshot', async () => {
 let i=0; const base=createMemoryRepository(); const repo={...base,transaction:async(owner,fn)=>base.transaction(owner,async tx=>{const snapshot=await tx.list(owner,'tasks'); const view={...tx,list:async(o,c,q)=>c==='tasks'?snapshot.filter(t=>!q||Object.entries(q).every(([k,v])=>t[k]===v)):tx.list(o,c,q)}; return fn(view);})};
 const deps={repository:repo,now:()=> '2026-11-04T00:00:00Z',newId:()=>`s${++i}`}; const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps); const ok=async p=>{const r=await p; assert.equal(r.ok,true,JSON.stringify(r)); return r.data;};
 const p=await ok(call('profiles.create',{record:{displayName:'A'}})); await ok(call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}]})); const t=await ok(call('tasks.create',{record:{title:'T',remainingMinutes:60}})); await ok(call('plan.generate',{expectedVersion:0}));
 const result=await ok(call('plan.progress',{expectedVersion:1,changes:[{id:t.id,expectedVersion:1,remainingMinutes:0,completed:true}]})); assert.ok(result.plan.blocks.every(b=>b.taskId!==t.id));
});
test('locked future study time counts toward remaining work', () => {
 const {replan}=require('../cloudfunctions/api/core/revisions'); const result=replan({version:1,now:'2026-11-04T00:00:00Z',tasks:[{id:'a',version:1,status:'pending',remainingMinutes:60}],availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}],blocks:[{id:'m',taskId:'a',locked:true,start:'2026-11-04T00:00:00Z',end:'2026-11-04T01:00:00Z'}]},{}); assert.equal(result.plan.blocks.length,1);
});
test('progress replan keeps unaffected future blocks and identifies changed blocks', () => {
 const {replan}=require('../cloudfunctions/api/core/revisions'); const state={version:1,now:'2026-11-04T00:00:00Z',tasks:[{id:'a',version:2,status:'pending',remainingMinutes:30},{id:'b',version:1,status:'pending',remainingMinutes:60}],availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T05:00:00Z'}],blocks:[{id:'b-block',taskId:'b',taskVersion:1,start:'2026-11-04T02:00:00Z',end:'2026-11-04T03:00:00Z'}]}; const result=replan(state,{id:'r',taskIds:['a']}); assert.ok(result.plan.blocks.some(b=>b.id==='b-block')); assert.ok(Array.isArray(result.revision.removedBlocks)); assert.ok(Array.isArray(result.revision.addedBlocks));
});
test('manual blocks cannot overlap scheduled classes', async()=>{
 let i=0; const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`v${++i}`};const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps); const ok=async p=>{const r=await p;assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
 const p=await ok(call('profiles.create',{record:{displayName:'A'}})); const s=await ok(call('semesters.create',{record:{name:'S',startDate:'2026-11-02',endDate:'2026-12-30',teachingWeeks:8}})); await ok(call('courses.create',{record:{name:'C',semesterId:s.id,schedule:[{weekday:3,weeks:[1],periods:[1]}]}})); await ok(call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[],termPeriodTimes:{1:{start:'09:00',end:'10:00'}}})); const t=await ok(call('tasks.create',{record:{title:'T',remainingMinutes:60}})); await ok(call('plan.generate',{expectedVersion:0})); const r=await call('plan.manualBlock',{expectedVersion:1,block:{taskId:t.id,start:'2026-11-04T01:00:00Z',end:'2026-11-04T02:00:00Z'}}); assert.equal(r.ok,false); assert.equal(r.error.code,'CONFLICT');
});
test('undo restores prior unscheduled information along with blocks',()=>{
 const {replan,undoRevision}=require('../cloudfunctions/api/core/revisions'); const state={version:1,now:'2026-11-04T00:00:00Z',tasks:[{id:'a',version:1,status:'pending',remainingMinutes:60}],availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T02:00:00Z'}],blocks:[],unscheduled:[{taskId:'a',remainingMinutes:60,reason:'no_availability'}],reasons:[{taskId:'a',reason:'no_availability'}]}; const r=replan(state,{id:'r'}); const undo=undoRevision({...r.plan,version:2},r.revision,2); assert.deepEqual(undo.plan.unscheduled,state.unscheduled); assert.deepEqual(undo.plan.reasons,state.reasons);
});
test('exam and high-priority tasks win equal deadlines while overdue tasks remain visible',()=>{
 const {buildPlan}=require('../cloudfunctions/api/core/planner'); const tasks=[{id:'normal',version:1,status:'pending',remainingMinutes:60,dueAt:'2026-11-04',priority:'low'},{id:'exam',version:1,status:'pending',remainingMinutes:60,dueAt:'2026-11-04',type:'exam',priority:'high'},{id:'late',version:1,status:'pending',remainingMinutes:60,dueAt:'2026-11-03'}]; const result=buildPlan({tasks,availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T01:00:00Z'}],fixedBlocks:[],now:'2026-11-04T00:00:00Z'}); assert.equal(result.blocks[0].taskId,'exam'); assert.equal(result.unscheduled.find(x=>x.taskId==='late').reason,'overdue');
});
test('generic deletion cannot bypass planner revision rules',async()=>{
 let i=0;const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`q${++i}`}; const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps); await call('plan.generate',{expectedVersion:0}); const result=await call('data.delete',{confirmed:true,scope:{collection:'plans',records:[{id:'current',version:1}]}}); assert.equal(result.ok,false); assert.equal(result.error.code,'VALIDATION');
});
test('undo previews a conflict after availability settings change',async()=>{
 let i=0;const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`j${++i}`};const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps);const ok=async p=>{let r=await p;assert.equal(r.ok,true,JSON.stringify(r));return r.data}; const p=await ok(call('profiles.create',{record:{displayName:'A'}})); const generated=await ok(call('plan.generate',{expectedVersion:0})); await ok(call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[]})); const undo=await ok(call('plan.undo',{expectedVersion:1,revisionId:generated.revision.id})); assert.ok(undo.conflicts.some(x=>x.reason==='settings_changed'));
});
test('changed course timetable reports conflict with existing locked block before regenerating',async()=>{
 let i=0;const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`k${++i}`};const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps);const ok=async p=>{let r=await p;assert.equal(r.ok,true,JSON.stringify(r));return r.data};const p=await ok(call('profiles.create',{record:{displayName:'A'}}));const s=await ok(call('semesters.create',{record:{name:'S',startDate:'2026-11-02',endDate:'2026-12-30',teachingWeeks:8}}));await ok(call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[],termPeriodTimes:{1:{start:'09:00',end:'10:00'}}}));const t=await ok(call('tasks.create',{record:{title:'T',remainingMinutes:60}}));await ok(call('plan.generate',{expectedVersion:0}));await ok(call('plan.manualBlock',{expectedVersion:1,block:{taskId:t.id,start:'2026-11-04T01:00:00Z',end:'2026-11-04T02:00:00Z'}}));await ok(call('courses.create',{record:{name:'C',semesterId:s.id,schedule:[{weekday:3,weeks:[1],periods:[1]}]}}));const r=await ok(call('plan.generate',{expectedVersion:2}));assert.ok(r.conflicts.some(x=>x.reason==='class_overlap'));assert.equal((await ok(call('plan.get'))).version,2);
});
test('user planner settings constrain generated block duration',async()=>{
 let i=0;const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`l${++i}`};const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps);const ok=async p=>{let r=await p;assert.equal(r.ok,true,JSON.stringify(r));return r.data}; const p=await ok(call('profiles.create',{record:{displayName:'A'}}));await ok(call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[{start:'2026-11-04T00:00:00Z',end:'2026-11-04T04:00:00Z'}],plannerSettings:{minMinutes:30,maxMinutes:45,breakMinutes:15}}));await ok(call('tasks.create',{record:{title:'T',remainingMinutes:90}}));const result=await ok(call('plan.generate',{expectedVersion:0}));assert.equal(result.plan.blocks.length,2);assert.ok(result.plan.blocks.every(b=>Date.parse(b.end)-Date.parse(b.start)<=45*60000));assert.equal(Date.parse(result.plan.blocks[1].start)-Date.parse(result.plan.blocks[0].end),15*60000);
});
test('invalid planner settings are rejected without changing profile',async()=>{
 let i=0;const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`n${++i}`}; const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps); const p=(await call('profiles.create',{record:{displayName:'A'}})).data; for(const plannerSettings of [{minMinutes:29,maxMinutes:90,breakMinutes:10},{minMinutes:60,maxMinutes:30,breakMinutes:10},{minMinutes:30,maxMinutes:90,breakMinutes:-1}]) {const r=await call('profiles.setAvailability',{id:p.id,expectedVersion:1,availability:[],plannerSettings});assert.equal(r.error.code,'VALIDATION');} assert.equal((await call('profiles.get',{id:p.id})).data.version,1);
});
test('manual locked block can be removed with current plan version',async()=>{
 let i=0;const deps={repository:createMemoryRepository(),now:()=> '2026-11-04T00:00:00Z',newId:()=>`m${++i}`};const call=(action,payload={})=>api.handleAction({owner:'a',action,payload},deps);const ok=async p=>{let r=await p;assert.equal(r.ok,true,JSON.stringify(r));return r.data};const t=await ok(call('tasks.create',{record:{title:'T',remainingMinutes:60}}));await ok(call('plan.generate',{expectedVersion:0}));const p=await ok(call('plan.manualBlock',{expectedVersion:1,block:{taskId:t.id,start:'2026-11-04T01:00:00Z',end:'2026-11-04T02:00:00Z'}}));const r=await ok(call('plan.removeManualBlock',{expectedVersion:2,blockId:p.blocks[0].id}));assert.equal(r.blocks.length,0);assert.equal(r.version,3);
});
