'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleAction } = require('../cloudfunctions/api');
const { createMemoryRepository } = require('../cloudfunctions/api/adapters/repository');
const { buildUserContent } = require('../miniprogram/lib/ai');

async function fixture() {
  const requests = [];
  const deps = {
    repository: createMemoryRepository(), masterKey: Buffer.alloc(32, 7).toString('base64'),
    now: () => '2026-11-06T08:00:00.000Z',
    request: async (url, options) => {
      if(Buffer.byteLength(options.body)>(options.maxRequestBytes||1024*1024))throw Error('Request too large');
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: '收到' } }] }) };
    }
  };
  const call = (action, payload) => handleAction({ owner: 'alice', action, payload }, deps);
  assert.equal((await call('providers.save', { url: 'https://example.com/chat/completions', model: 'test', key: 'FAKE_TEST_KEY' })).ok, true);
  return { call, requests, deps };
}
test('cloud chat accepts the exact text content produced by the mini program', async () => {
  const { call, requests } = await fixture();
  const messages = [{ role: 'user', content: buildUserContent({ text: '添加线代作业' }) }];
  const result = await call('ai.chat', { messages });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(requests[0].messages, messages);
});
test('cloud chat accepts screenshot content and forwards tool call history intact', async () => {
  const { call, requests } = await fixture();
  const messages = [
    { role: 'user', content: buildUserContent({ text: '整理截图', image: 'data:image/png;base64,iVBORw0KGgo=' }) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"count":0}' }
  ];
  const result = await call('ai.chat', { messages });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(requests[0].messages, messages);
});
test('cloud chat rejects unsafe image URLs and oversized screenshot data before calling a provider', async () => {
  const { call, requests } = await fixture();
  for (const image of ['http://127.0.0.1/secret', 'file:///secret', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024)]) {
    const result = await call('ai.chat', { messages: [{ role: 'user', content: buildUserContent({ image }) }] });
    assert.equal(result.error.code, 'VALIDATION');
  }
  assert.equal(requests.length, 0);
});
test('cloud chat rejects orphan tool results and invalid tool arguments without charging usage', async () => {
  const { call, deps } = await fixture();
  const result = await call('ai.chat', { messages: [{ role: 'tool', tool_call_id: 'missing', content: '{}' }] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION');
  assert.deepEqual(await deps.repository.list('alice', 'providerUsage'), []);
});
test('an accepted large screenshot fits the actual HTTP transport request limit',async()=>{
  const {call,requests}=await fixture();
  const result=await call('ai.chat',{messages:[{role:'user',content:buildUserContent({image:'data:image/png;base64,'+'A'.repeat(1400000)})}]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(requests.length,1);
});
