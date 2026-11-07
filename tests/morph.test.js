'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const morph=require('../miniprogram/lib/morph');

test('a small source chip can expand exactly into the centered surface',()=>{
  const result=morph.transform({left:20,top:40,width:44,height:44}, {left:100,top:180,width:360,height:520});
  assert.equal(result.translateX,-80);
  assert.equal(result.translateY,-140);
  assert.equal(result.scaleX,44/360);
  assert.equal(result.scaleY,44/520);
  assert.match(morph.transformStyle(result),/translate\(-80px, -140px\)/);
});

test('a task row keeps its full width while collapsing to a centered card',()=>{
  const result=morph.transform({left:16,top:220,width:340,height:64}, {left:20,top:120,width:360,height:520});
  assert.equal(result.translateX,-4);
  assert.equal(result.translateY,100);
  assert.equal(result.scaleX,340/360);
  assert.equal(result.scaleY,64/520);
});

test('tap points create a predictable anchor when DOM geometry is unavailable',()=>{
  const rect=morph.touchRect({detail:{x:200,y:320}}, {width:44,height:44,radius:12});
  assert.deepEqual(rect,{left:178,top:298,width:44,height:44,radius:12});
});

test('missing source geometry falls back to a centered crossfade target',()=>{
  assert.deepEqual(morph.fallbackRect(),{left:0,top:0,width:0,height:0,radius:16});
  assert.equal(morph.transformStyle(morph.transform(morph.fallbackRect(),{left:10,top:10,width:300,height:400})).includes('scale(0, 0)'),false);
});

test('a failed card measurement cannot create an exploding scale',()=>{
  const result=morph.transform({left:20,top:40,width:44,height:44,radius:12},{left:0,top:0,width:0,height:0});
  assert.equal(result.scaleX,0.86);
  assert.equal(result.scaleY,0.92);
});
