'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');

function setup(kind) {
  const record=kind==='task'?{id:'t1',title:'Report',remainingMinutes:60,status:'open',version:1,typeIndex:0,priorityIndex:1,courseId:''}:{id:'c1',name:'Course',semester:'2026',importance:'medium',mastery:'medium'};
  const store={courses:kind==='course'?[record]:[],tasks:kind==='task'?[record]:[],availability:[],blocks:[],unscheduled:[],previous:null};
  const storage={study_trial_v1:structuredClone(store)},dialogs=[];
  global.wx={getStorageSync:key=>storage[key],setStorageSync:(key,value)=>{storage[key]=structuredClone(value);},showModal:options=>dialogs.push(options),showToast(){}};
  let definition;global.Page=value=>{definition=value;};
  for(const file of ['../miniprogram/lib/sync','../miniprogram/pages/today/index'])delete require.cache[require.resolve(file)];
  require('../miniprogram/pages/today/index');
  const page={...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  page.data.store=structuredClone(store);page.refresh();
  page[kind==='task'?'openTask':'openCourse']({currentTarget:{dataset:{id:record.id}}});
  return {page,storage,dialogs};
}

test('saving an old task draft cannot reverse AI progress and preserves the draft for resolution',()=>{
  const {page,storage,dialogs}=setup('task');
  storage.study_trial_v1.tasks[0]={...storage.study_trial_v1.tasks[0],status:'completed',remainingMinutes:10,version:2};
  page.data.store=structuredClone(storage.study_trial_v1);page.refresh();
  const before=JSON.stringify(storage.study_trial_v1);
  page.saveEditor();
  assert.equal(JSON.stringify(storage.study_trial_v1),before);
  assert.equal(page.data.taskForm.remainingMinutes,60);assert.equal(page.data.editing,'task');
  assert.match(dialogs[0].content,/草稿/);
});

test('saving a draft after AI deletion does not recreate the deleted task',()=>{
  const {page,storage}=setup('task');storage.study_trial_v1.tasks=[];
  page.data.store=structuredClone(storage.study_trial_v1);page.refresh();page.saveEditor();
  assert.deepEqual(storage.study_trial_v1.tasks,[]);assert.equal(page.data.taskForm.title,'Report');
});

test('a retained course draft cannot overwrite a course edited or deleted by AI',()=>{
  for(const deleted of [false,true]){
    const {page,storage}=setup('course');
    if(deleted)storage.study_trial_v1.courses=[];else storage.study_trial_v1.courses[0].name='Updated';
    page.data.store=structuredClone(storage.study_trial_v1);const before=JSON.stringify(storage.study_trial_v1);
    page.saveEditor();assert.equal(JSON.stringify(storage.study_trial_v1),before);assert.equal(page.data.courseForm.name,'Course');
  }
});

test('unchanged editors save normally and accept an unrelated newly created task',()=>{
  const {page,storage,dialogs}=setup('task');
  storage.study_trial_v1.tasks.push({id:'other',title:'Other',status:'open'});
  page.data.taskForm.title='Revised';page.saveEditor();
  assert.equal(storage.study_trial_v1.tasks.find(t=>t.id==='t1').title,'Revised');
  assert.equal(storage.study_trial_v1.tasks.find(t=>t.id==='other').title,'Other');assert.equal(dialogs.length,0);
});

test('a changed course picker cannot silently reassign the task to another course',()=>{
  const {page,storage}=setup('task');
  storage.study_trial_v1.courses=[{id:'c1',name:'First'},{id:'c2',name:'Second'}];
  page.data.store=structuredClone(storage.study_trial_v1);page.refresh();
  page.openTask({currentTarget:{dataset:{id:'t1'}}});page.data.courseIndex=1;
  storage.study_trial_v1.courses.shift();
  page.saveEditor();assert.equal(storage.study_trial_v1.tasks[0].courseId,'');assert.equal(page.data.editing,'task');
});
