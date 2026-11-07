'use strict';
// 云函数代调模型：前端只发 messages，Key 全程留在服务端。
//
// 和 adapters/model.js 的区别：那个是为「结构化抽取」设计的，强制 response_format=json_object
// 并做 schema 校验；这里要跑对话和 tool_calls，必须是自由格式，所以单独实现。
//
// 为什么要走服务端：前端直连时 Key 必须以明文存在手机上，一清缓存就丢；
// 加密存云端后又没有主密钥解不开。放在云函数里，Key 只以密文存在，请求也从服务端发出。

const { fail, failWith } = require('./errors');
const { decryptSecret } = require('./vault');
const { safeRequest } = require('../adapters/safe-http');

const MAX_MESSAGES = 30;
const MAX_TOTAL_CHARS = 60000;
const MAX_TOKENS = 4096;
const ALLOWED_ROLES = ['system', 'user', 'assistant', 'tool'];
const MAX_IMAGE_CHARS = 2 * 1024 * 1024;

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) fail('VALIDATION');
  let textChars = 0, imageChars = 0;
  const waiting = new Set();
  for (const message of messages) {
    if (!message || !ALLOWED_ROLES.includes(message.role)) fail('VALIDATION');
    if (waiting.size && message.role !== 'tool') fail('VALIDATION');
    if (Array.isArray(message.content)) {
      if (message.role !== 'user' || !message.content.length || message.content.length > 6) fail('VALIDATION');
      for (const part of message.content) {
        if (part && part.type === 'text' && typeof part.text === 'string') textChars += part.text.length;
        else if (part && part.type === 'image_url') {
          const url = part.image_url && part.image_url.url;
          if (typeof url !== 'string' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) fail('VALIDATION');
          imageChars += url.length;
        } else fail('VALIDATION');
      }
    } else if (typeof message.content === 'string') textChars += message.content.length;
    else if (!(message.role === 'assistant' && message.content == null && Array.isArray(message.tool_calls))) fail('VALIDATION');
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string' || !waiting.delete(message.tool_call_id)) fail('VALIDATION');
    } else if (message.tool_call_id !== undefined) fail('VALIDATION');
    if (message.tool_calls !== undefined) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || !message.tool_calls.length || message.tool_calls.length > 10) fail('VALIDATION');
      for (const call of message.tool_calls) {
        if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 200 || waiting.has(call.id) || call.type !== 'function' || !call.function || !/^[A-Za-z0-9_-]{1,64}$/.test(call.function.name) || typeof call.function.arguments !== 'string' || call.function.arguments.length > 10000) fail('VALIDATION');
        try { const args = JSON.parse(call.function.arguments); if (!args || typeof args !== 'object' || Array.isArray(args)) fail('VALIDATION'); } catch (_) { fail('VALIDATION'); }
        waiting.add(call.id);
      }
    }
    if (textChars > MAX_TOTAL_CHARS || imageChars > MAX_IMAGE_CHARS) fail('VALIDATION');
  }
  if (waiting.size) fail('VALIDATION');
}

// 限流按北京时间自然日算，和 providerUsage 里 model.js 的口径保持一致。
function chinaDate(iso) {
  return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);
}
function isDeepSeek(url) {
  try { return new URL(url).hostname === 'api.deepseek.com'; }
  catch (_) { return false; }
}
function modelHttpFailure(status) {
  if (status === 401 || status === 403) fail('MODEL_AUTH');
  if (status === 402) fail('MODEL_QUOTA');
  if (status === 429) fail('MODEL_RATE_LIMIT');
  failWith('MODEL_HTTP', `模型接口返回 HTTP ${status || '未知状态'}，请检查模型配置或稍后重试`);
}

async function handleAiChat({ owner, action, payload }, deps) {
  if (action !== 'ai.chat') fail('UNKNOWN_ACTION');

  const messages = payload && payload.messages;
  validateMessages(messages);
  if (payload.tools !== undefined && (!Array.isArray(payload.tools) || payload.tools.length > 16 || JSON.stringify(payload.tools).length > 60000)) fail('VALIDATION');

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
  // V4.1 Flash 默认开启 thinking；带 tools 的对话若下一轮丢掉 reasoning_content 会 400。
  // 本项目要的是稳定的工具循环，显式关闭 thinking，也不把推理链展示给用户。
  if (isDeepSeek(setting.url)) body.thinking = { type: 'disabled' };
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
      maxBytes: 2 * 1024 * 1024,
      maxRequestBytes: 3 * 1024 * 1024,
      timeout: 25000
    });
  } catch (error) {
    if (/timeout/i.test(String(error && error.message))) fail('MODEL_TIMEOUT');
    fail('MODEL_NETWORK');
  }
  if (!response.ok) modelHttpFailure(Number(response.status) || 0);

  let output;
  try { output = await response.json(); } catch (error) { fail('MODEL_BAD_RESPONSE'); }
  const message = output && output.choices && output.choices[0] && output.choices[0].message;
  if (!message) fail('MODEL_EMPTY');

  return {
    message,
    model: output.model || setting.model,
    usage: output.usage && Number.isSafeInteger(output.usage.total_tokens) ? output.usage.total_tokens : null
  };
}

module.exports = { handleAiChat };
