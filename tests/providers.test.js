'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../cloudfunctions/api');
const { createMemoryRepository } = require('../cloudfunctions/api/adapters/repository');
const vault = require('../cloudfunctions/api/core/vault');
const http = require('../cloudfunctions/api/adapters/safe-http');
const { callModel } = require('../cloudfunctions/api/adapters/model');
const masterKey = Buffer.alloc(32, 7).toString('base64');
function setup() { const repository = createMemoryRepository(); const deps = {repository, masterKey, now: () => '2026-11-04T00:00:00.000Z'}; return {deps, repository, call: (action,payload={},owner='alice') => api.handleAction({owner,action,payload},deps)}; }
test('vault authenticates encrypted credentials', () => { const e=vault.encryptSecret('abc-secret',masterKey); assert.equal(vault.decryptSecret(e,masterKey),'abc-secret'); e.tag=Buffer.alloc(16).toString('base64'); assert.throws(()=>vault.decryptSecret(e,masterKey)); });
test('provider settings never reveal key and are owner bound', async () => { const {call,repository}=setup(); const saved=await call('providers.save',{url:'https://example.com/v1/chat/completions',model:'m',key:'abc-secret'}); assert.equal(saved.ok,true); assert.equal(JSON.stringify(saved).includes('abc-secret'),false); assert.equal(JSON.stringify(await repository.get('alice','providerSettings','default')).includes('abc-secret'),false); assert.equal((await call('providers.get',{},'bob')).data,null); assert.equal((await call('providers.delete')).ok,true); assert.equal((await call('providers.get')).data,null); });
test('network rejects private addresses, local IPv6 and DNS to private', async () => { for (const address of ['127.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(http.isPublicAddress(address),false,address); await assert.rejects(http.safeRequest('https://example.com/',{lookup:async()=>[{address:'10.0.0.1',family:4}]})); });
test('invalid model JSON does not create tasks and error does not disclose credential', async () => { const {deps,call}=setup(); await call('providers.save',{url:'https://example.com/v1/chat/completions',model:'m',key:'abc-secret'}); deps.request=async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'not JSON'}}]})}); const result=await call('imports.extractText',{text:'homework'}); assert.equal(result.ok,false); assert.equal(JSON.stringify(result).includes('abc-secret'),false); assert.equal((await call('tasks.list')).data.length,0); });
test('model validates schema and enforces owner usage cap', async()=> { const {deps,call}=setup(); await call('providers.save',{url:'https://example.com/v1/chat/completions',model:'m',key:'key'}); deps.request=async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'{"ok":true}'}}],usage:{total_tokens:10}})}); const r=await callModel({owner:'alice',purpose:'test',messages:[{role:'user',content:'hello'}],schema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}}}},deps); assert.equal(r.value.ok,true); deps.dailyCallLimit=1; await assert.rejects(callModel({owner:'alice',purpose:'test',messages:[],schema:{type:'object'}},deps)); });
test('exports never expose encrypted provider credentials', async()=>{const {call}=setup(); await call('providers.save',{url:'https://example.com/',model:'m',key:'abc-secret'}); const exported=await call('data.export'); assert.equal(exported.data.json.includes('keyEnvelope'),false);});
test('all redirects are refused even to another public host', async()=>{const {validateResponseStatus}=require('../cloudfunctions/api/adapters/safe-http'); assert.equal(typeof validateResponseStatus,'function'); assert.throws(()=>validateResponseStatus(302));});
test('daily model usage is counted by China calendar day', async () => {
  const { deps, repository, call } = setup();
  await call('providers.save', { url: 'https://example.com/v1/chat/completions', model: 'm', key: 'key' });
  deps.request = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  // 17:30 UTC is already the next day in Beijing, so the counter must roll over there.
  deps.now = () => '2026-11-04T17:30:00.000Z';
  const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
  await callModel({ owner: 'alice', purpose: 'test', messages: [{ role: 'user', content: 'hello' }], schema }, deps);
  const usage = await repository.list('alice', 'providerUsage');
  assert.deepEqual(usage.map(record => record.id), ['day_20261105']);
});
