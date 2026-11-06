'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const path=require('node:path');
test('default configuration check validates the actual mini program instead of the empty example',()=>{
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/check-config.js')],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout),{ready:true,missing:[]});
});
