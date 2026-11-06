'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const ai=require('../miniprogram/lib/ai');const backup=require('../miniprogram/lib/backup');
const settings={url:'https://example.com/chat/completions',model:'test',apiKey:'FAKE_NEW_KEY'};
test('cloud settings save removes local plaintext only after the cloud acknowledges',async()=>{
  const storage={study_ai_v1:{...settings,apiKey:'FAKE_OLD_KEY'}};
  const saved=await ai.persistSettings(settings,{cloudAvailable:true,call:async()=>({keyMasked:'••••'}),setStorage:(k,v)=>{storage[k]=v;}});
  assert.equal(storage.study_ai_v1.apiKey,'');assert.equal(saved.apiKey,'');assert.equal(saved.cloudSaved,true);
});
test('failed cloud settings save keeps the previous settings intact and reports failure',async()=>{
  const previous={...settings,apiKey:'FAKE_OLD_KEY'};const storage={study_ai_v1:previous};
  await assert.rejects(ai.persistSettings(settings,{cloudAvailable:true,call:async()=>{throw Error('offline');},setStorage:(k,v)=>{storage[k]=v;}}),/offline/);
  assert.deepEqual(storage.study_ai_v1,previous);
});
test('new backup exports never copy a provider key into the clipboard payload',()=>{
  const exported=backup.buildBackup({trial:{courses:[],tasks:[]},ai:settings});
  assert.equal(JSON.stringify(exported).includes('FAKE_NEW_KEY'),false);
});
