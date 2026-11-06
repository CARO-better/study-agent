'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
test('dated classes are stored separately from free time and repeated without claiming availability',async()=>{
 const storage={};global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=structuredClone(v),showToast(){}};
 let def;global.Page=d=>{def=d;};delete require.cache[require.resolve('../miniprogram/pages/today/index')];require('../miniprogram/pages/today/index');
 const page={...def,data:structuredClone(def.data),setData(p){Object.assign(this.data,p);}};
 page.data.availabilityForm={date:'2026-11-07',start:'08:00',end:'10:00',fixed:true,repeatWeeks:2,title:'高数课'};
 page.saveAvailability();
 assert.equal(storage.study_trial_v1.availability.length,0);assert.equal(storage.study_trial_v1.fixedBlocks.length,2);
 assert.equal(storage.study_trial_v1.fixedBlocks[1].start,'2026-11-14T00:00:00.000Z');
});
