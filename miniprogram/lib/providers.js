'use strict';
// 常见模型服务的预置项。地址与模型名会随服务商调整，改动只要动这个文件。
// vision 表示官方文档确认支持图片输入；false 不代表一定不行，只是没查证，截图场景别依赖它。

const PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    vision: true,
    note: '官方 Search API 支持联网检索；图片能力以当前官方文档与真机验证为准'
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'kimi-k2.6',
    vision: true,
    note: 'K2.6 支持图片输入；也可换成 kimi-k3 等更新的模型名'
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    url: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.6-flash',
    vision: false,
    note: '接口兼容 OpenAI；官方未标注读图能力，截图场景建议用 DeepSeek 或 Kimi'
  }
];

function presetById(id) {
  return PRESETS.find(preset => preset.id === id) || null;
}

// 只替换地址与模型名，API Key 原样保留。
function applyPreset(settings, id) {
  const preset = presetById(id);
  const base = settings || {};
  if (!preset) return { ...base, presetId: 'custom' };
  return { ...base, presetId: preset.id, url: preset.url, model: preset.model };
}

function matchPreset(settings) {
  if (!settings || !settings.url) return null;
  return PRESETS.find(preset => preset.url === String(settings.url).trim()) || null;
}

module.exports = { PRESETS, presetById, applyPreset, matchPreset };
