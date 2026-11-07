'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const images=require('../miniprogram/lib/image-request');
test('small screenshots keep their original bytes and correct MIME type',async()=>{
 const p={getFileSystemManager:()=>({readFile:o=>o.success({data:'iVBORabc'})})};
 assert.equal(await images.prepare({tempFilePath:'a',size:6},p),'data:image/png;base64,iVBORabc');
});
test('large photos are resized by their long edge before base64 enters page data',async()=>{
 let calls=0,options;const p={getImageInfo:o=>o.success({width:1800,height:4000,type:'jpeg'}),compressImage:o=>{calls++;options=o;o.success({tempFilePath:'compressed'});},getFileSystemManager:()=>({readFile:o=>o.success({data:calls===1?'/9j/'+ 'A'.repeat(80000):'/9j/abc'})})};
 assert.equal(await images.prepare({tempFilePath:'large',size:1500000},p),'data:image/jpeg;base64,/9j/abc');assert.equal(calls,2);
 assert.ok(options.compressedWidth<=1440&&options.compressedHeight<=1440,'a portrait photo must also be bounded by its height');
 assert.equal(options.compressedWidth,648);assert.equal(options.compressedHeight,1440);
});
test('a smaller PNG screenshot is transcoded to JPEG instead of repeating width-only compression',async()=>{
 let compressed=false,canvasSize;
 const p={getImageInfo:o=>o.success({width:720,height:4000,type:'png'}),
  compressImage:o=>{compressed=true;o.fail({errMsg:'compressImage:fail iOS only supports JPG'});},
  createSelectorQuery:()=>({select:()=>({fields:()=>({exec:resolve=>resolve([{node:{width:1,height:1,getContext:()=>({fillRect(){},drawImage(){}}),createImage:()=>({set src(value){this.path=value;setTimeout(()=>this.onload&&this.onload(),0);}})},width:1,height:1}])})})}),
  canvasToTempFilePath:o=>{canvasSize=[o.canvas.width,o.canvas.height];o.success({tempFilePath:'jpeg'});},
  getFileSystemManager:()=>({readFile:o=>o.success({data:o.filePath==='jpeg'?'/9j/abc':'iVBOR'+'A'.repeat(100000)})})};
 const result=await images.prepare({tempFilePath:'270kb.png',size:270000},p);
 assert.match(result,/^data:image\/jpeg;base64,/);assert.equal(compressed,false,'PNG must not rely on a compression path documented as JPEG-only');
 assert.deepEqual(canvasSize,[259,1440]);
});
test('uncompressible screenshots fail locally with an actionable message',async()=>{
 const p={getImageInfo:o=>o.success({width:1600,height:1600,type:'png'}),compressImage:o=>o.success({tempFilePath:'compressed'}),getFileSystemManager:()=>({readFile:o=>o.success({data:'iVBOR'+'A'.repeat(100000)})})};
 await assert.rejects(images.prepare({tempFilePath:'large',size:1500000},p),error=>error.code==='IMAGE_TOO_LARGE'&&/裁剪/.test(error.message));
});
test('request guard measures the complete UTF-8 JSON envelope including tools and history',()=>{
 assert.equal(images.bytes('中😀'),7);images.check({messages:[{content:'small'}]});
 assert.throws(()=>images.check({messages:[{content:'中'.repeat(31000)}]}),e=>e.code==='PAYLOAD_TOO_LARGE');
});
