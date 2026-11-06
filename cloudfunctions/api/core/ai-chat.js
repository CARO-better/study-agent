'use strict';
// 云函数代调模型：前端只发 messages，Key 全程留在服务端。
//
// 和 adapters/model.js 的区别：那个是为「结构化抽取」设计的，强制 response_format=json_object
// 并做 schema 校验；这里要跑对话和 tool_calls，必须是自由格式，所以单独实现。
//
// 为什么要走服务端：前端直连时 Key 必须以明文存在手机上，一清缓存就丢；
// 加密存云端后又没有主密钥解不开。放在云函数里，Key 只以密文存在，请求也从服务端发出。

const { fail } = require('./errors');
const { decryptSecret } = require('./vault');
const { safeRequest } = require('../adapters/safe-http');

const MAX_MESSAGES = 30;
const MAX_TOTAL_CHARS = 60000;
const MAX_TOKENS = 4096;
const ALLOWED_ROLES = ['system', 'user', 'assistant', 'tool'];

// 限流按北京时间自然日算，和 providerUsage 里 model.js 的口径保持一致。
function chinaDate(iso) {
  return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);
}

async function handleAiChat({ owner, action, payload }, deps) {
  if (action !== 'ai.chat') fail('UNKNOWN_ACTION');

  const messages = payload && payload.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) fail('VALIDATION');
  let chars = 0;
  for (const message of messages) {
    if (!message || !ALLOWED_ROLES.includes(message.role)) fail('VALIDATION');
    if (message.content != null && typeof message.content !== 'string') fail('VALIDATION');
    chars += (message.content || '').length;
  }
  if (chars > MAX_TOTAL_CHARS) fail('VALIDATION');

  const setting = await deps.repository.get(owner, 'providerSettings', 'default');
  if (!setting || !setting.keyEnvelope) fail('PROVIDER_UNCONFIGURED');

  const usageId = 'day_' + chinaDate(deps.now()).replace(/-/g, '');
  const limit = Math.min(deps.dailyCallLimit || 30, 100);
  await deps.repository.transaction(owner, async tx => {
    const prev = await tx.get(owner, 'providerUsage', usageId);
    const count = (prev && prev.count) || 0;
    if (count >= limit) fail('USAGE_LIMIT');
    await tx.save(owner, 'providerUsage', { id: usageId, count: count + 1 }, (prev && prev.version) || 0);
  });

  let key;
  try {
    key = decryptSecret(setting.keyEnvelope, deps.masterKey);
  } catch (error) {
    // 主密钥缺失或更换过，密文解不开。单独给一个码，否则和「没配模型」混在一起很难查。
    fail('MASTER_KEY_MISSING');
  }

  const body = { model: setting.model, messages, temperature: 0.3, max_tokens: MAX_TOKENS };
  const tools = payload && payload.tools;
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let response;
  try {
    response = await (deps.request || safeRequest)(setting.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      maxBytes: 2 * 1024 * 1024
    });
  } catch (error) {
    fail('MODEL_FAILED');
  }
  if (!response.ok) fail('MODEL_FAILED');

  let output;
  try { output = await response.json(); } catch (error) { fail('MODEL_FAILED'); }
  const message = output && output.choices && output.choices[0] && output.choices[0].message;
  if (!message) fail('MODEL_FAILED');

  return {
    message,
    model: output.model || setting.model,
    usage: output.usage && Number.isSafeInteger(output.usage.total_tokens) ? output.usage.total_tokens : null
  };
}

module.exports = { handleAiChat };
