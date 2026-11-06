'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const images=require('../miniprogram/lib/image-request');
test('small screenshots keep their original bytes and correct MIME type',async()=>{
 const p={getFileSystemManager:()=>({readFile:o=>o.success({data:'iVBORabc'})})};
 assert.equal(await images.prepare({tempFilePath:'a',size:6},p),'data:image/png;base64,iVBORabc');
});
test('large photos are resized before base64 enters page data',async()=>{
 let calls=0;const p={getImageInfo:o=>o.success({width:1800}),compressImage:o=>{calls++;o.success({tempFilePath:'compressed'});},getFileSystemManager:()=>({readFile:o=>o.success({data:calls===1?'/9j/'+ 'A'.repeat(80000):'/9j/abc'})})};
 assert.equal(await images.prepare({tempFilePath:'large',size:1500000},p),'data:image/jpeg;base64,/9j/abc');assert.equal(calls,2);
});
test('uncompressible screenshots fail locally with an actionable message',async()=>{
 const p={getImageInfo:o=>o.success({width:1600}),compressImage:o=>o.success({tempFilePath:'compressed'}),getFileSystemManager:()=>({readFile:o=>o.success({data:'iVBOR'+'A'.repeat(100000)})})};
 await assert.rejects(images.prepare({tempFilePath:'large',size:1500000},p),/裁剪/);
});
test('request guard measures the complete UTF-8 JSON envelope including tools and history',()=>{
 assert.equal(images.bytes('中😀'),7);images.check({messages:[{content:'small'}]});
 assert.throws(()=>images.check({messages:[{content:'中'.repeat(31000)}]}),e=>e.code==='PAYLOAD_TOO_LARGE');
});
