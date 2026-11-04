'use strict';
// 客户端直连模型的最小 Agent：一次请求 → 模型决定调工具 → 本地执行 → 把结果回给模型 → 直到它给结论。
// 网络只在 requestModel 里，请求函数可注入，方便用 node 测整个循环。

const SETTINGS_KEY = 'study_ai_v1';
const DEFAULT_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-flash';
const MAX_ROUNDS = 4;

function emptySettings() {
  return { url: DEFAULT_URL, model: DEFAULT_MODEL, apiKey: '' };
}

function readSettings(getStorage) {
  const saved = getStorage(SETTINGS_KEY);
  return saved && typeof saved === 'object' ? { ...emptySettings(), ...saved } : emptySettings();
}

function saveSettings(setStorage, settings) {
  const clean = {
    url: String(settings.url || DEFAULT_URL).trim(),
    model: String(settings.model || DEFAULT_MODEL).trim(),
    apiKey: String(settings.apiKey || '').trim()
  };
  setStorage(SETTINGS_KEY, clean);
  return clean;
}

function ready(settings) {
  return Boolean(settings && settings.apiKey && settings.url && settings.model);
}

function systemPrompt({ date, courses = [], tasks = [] }) {
  const courseText = courses.length ? courses.map(course => course.name).join('、') : '（还没有课程）';
  const open = tasks.filter(task => task.status !== 'completed');
  return [
    '你是「学程」小程序里的学习助理，帮学生把课表、作业通知、聊天记录整理成待办。',
    `今天是 ${date}（北京时间）。`,
    `已有课程：${courseText}。`,
    `当前未完成任务 ${open.length} 条。`,
    '',
    '规则：',
    '1. 要新增或修改数据时，必须调用工具，不能只在回复里描述。',
    '2. 日期一律 YYYY-MM-DD；截图或原话里没有明确日期就不要猜，留空并说明。',
    '3. 不要删除任何数据，不要改写已有任务的标题和截止日期。',
    '4. 截图里只提取明确写出的信息，看不清的字段要问用户，不要编造。',
    '5. 用中文简短回复，说清你做了什么。'
  ].join('\n');
}

function buildUserContent({ text = '', image = '' } = {}) {
  const blocks = [];
  if (text && text.trim()) blocks.push({ type: 'text', text: text.trim() });
  if (image) blocks.push({ type: 'image_url', image_url: { url: image } });
  if (!blocks.length) blocks.push({ type: 'text', text: '（空消息）' });
  return blocks;
}

// Runs the tool loop. `request(messages)` returns a Chat Completions payload and
// `execute(name, args)` returns { store, result }; the caller owns persistence.
async function runAgent({ messages, request, execute, maxRounds = MAX_ROUNDS }) {
  const history = [...messages];
  const records = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const payload = await request(history);
    const message = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
    if (!message) throw Object.assign(Error('模型返回格式异常'), { code: 'MODEL_BAD_RESPONSE' });
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    history.push({ role: 'assistant', content: message.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { reply: message.content || '', history, records };
    for (const call of calls) {
      const name = call && call.function && call.function.name;
      let args = {};
      try { args = JSON.parse((call.function && call.function.arguments) || '{}'); } catch { args = {}; }
      const outcome = await execute(name, args);
      records.push({ name, result: outcome.result });
      history.push({ role: 'tool', tool_call_id: call.id || name, content: JSON.stringify(outcome.result) });
    }
  }
  return { reply: '这次改动比较多，我先停在这里，你可以让我继续。', history, records };
}

// Network boundary. Never puts the key into any error message or log.
function requestModel({ settings, messages, tools }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: settings.url,
      method: 'POST',
      timeout: 60000,
      header: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
      data: { model: settings.model, messages, tools, temperature: 0, max_tokens: 2000 },
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(Error(`模型接口返回 ${response.statusCode}`), { code: 'MODEL_HTTP' }));
          return;
        }
        resolve(response.data);
      },
      fail(error) {
        reject(Object.assign(Error(`网络请求失败：${(error && error.errMsg) || '未知原因'}`), { code: 'MODEL_NETWORK' }));
      }
    });
  });
}

function describeRecords(records) {
  return (records || []).map(record => {
    const result = record.result || {};
    if (record.name === 'create_task') return result.ok ? `已添加任务「${result.task.title}」` : `没添加：${result.reason}`;
    if (record.name === 'create_course') return result.ok ? `已添加课程「${result.course.name}」` : `没添加：${result.reason}`;
    if (record.name === 'update_task_status') return result.ok ? `已把「${result.title}」标记为${result.status === 'completed' ? '完成' : '未完成'}` : `没改：${result.reason}`;
    if (record.name === 'list_tasks') return `查询到 ${result.count} 条未完成任务`;
    return '完成一次操作';
  });
}

module.exports = {
  SETTINGS_KEY, DEFAULT_URL, DEFAULT_MODEL, emptySettings, readSettings, saveSettings, ready,
  systemPrompt, buildUserContent, runAgent, requestModel, describeRecords
};
