'use strict';
// 清缓存会连本地存储一起清掉，纯本地躲不开。能做的是"导出一份能带走的快照"：
// 复制成文本存到微信收藏/文件传输助手，清缓存后再粘贴回来。不含任何上传行为。

const FORMAT = 'study-agent/local-backup/v1';

function emptyTrial() {
  return { courses: [], tasks: [], availability: [], blocks: [], unscheduled: [], previous: null };
}

function buildBackup({ trial, ai, inbox }, exportedAt) {
  const source = trial && Array.isArray(trial.tasks) ? trial : emptyTrial();
  return {
    format: FORMAT,
    exportedAt: exportedAt || new Date().toISOString(),
    trial: {
      ...source,
      courses: Array.isArray(source.courses) ? source.courses : [],
      tasks: Array.isArray(source.tasks) ? source.tasks : [],
      availability: Array.isArray(source.availability) ? source.availability : [],
      blocks: Array.isArray(source.blocks) ? source.blocks : [],
      unscheduled: Array.isArray(source.unscheduled) ? source.unscheduled : [],
      previous: source.previous || null
    },
    ai: {
      url: String((ai && ai.url) || ''),
      model: String((ai && ai.model) || ''),
      apiKey: '',
      cloudSaved: Boolean(ai && ai.cloudSaved)
    },
    inbox: {
      messages: Array.isArray(inbox && inbox.messages) ? inbox.messages.slice(0, 30) : [],
      lastReadDate: (inbox && inbox.lastReadDate) || null
    }
  };
}

function bad(message) {
  return Object.assign(Error(message), { code: 'BACKUP_INVALID' });
}

// 只接受自己导出的格式；字段缺失就补空，字段类型不对就拒绝，避免把坏数据写回去。
function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) throw bad('备份内容是空的');
  let data;
  try { data = JSON.parse(text.trim()); } catch { throw bad('这段文本不是有效的 JSON，可能复制不全'); }
  if (!data || data.format !== FORMAT) throw bad('这不是本小程序导出的备份');
  if (!data.trial || typeof data.trial !== 'object' || !Array.isArray(data.trial.tasks)) throw bad('备份里没有任务数据');
  const trial = {
    ...emptyTrial(),
    ...data.trial,
    courses: Array.isArray(data.trial.courses) ? data.trial.courses : [],
    tasks: data.trial.tasks,
    availability: Array.isArray(data.trial.availability) ? data.trial.availability : [],
    blocks: Array.isArray(data.trial.blocks) ? data.trial.blocks : [],
    unscheduled: Array.isArray(data.trial.unscheduled) ? data.trial.unscheduled : []
  };
  const ai = data.ai && typeof data.ai === 'object' ? {
    url: String(data.ai.url || ''),
    model: String(data.ai.model || ''),
    apiKey: String(data.ai.apiKey || '')
  } : null;
  const inbox = data.inbox && Array.isArray(data.inbox.messages)
    ? { messages: data.inbox.messages.slice(0, 30), lastReadDate: data.inbox.lastReadDate || null }
    : { messages: [], lastReadDate: null };
  return { format: FORMAT, exportedAt: data.exportedAt || null, trial, ai, inbox };
}

function counts(backup) {
  const trial = (backup && backup.trial) || emptyTrial();
  return {
    courses: trial.courses.length,
    tasks: trial.tasks.length,
    done: trial.tasks.filter(task => task.status === 'completed').length,
    availability: trial.availability.length,
    hasKey: Boolean(backup && backup.ai && backup.ai.apiKey)
  };
}

function describe(backup) {
  const value = counts(backup);
  return `课程 ${value.courses} 门 · 任务 ${value.tasks} 条（已完成 ${value.done}）· 可用时段 ${value.availability} 个${value.hasKey ? ' · 含 API Key' : ''}`;
}

module.exports = { FORMAT, buildBackup, parseBackup, counts, describe, emptyTrial };
