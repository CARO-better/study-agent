'use strict';
const { fail } = require('./errors');
const { searchVideos } = require('../adapters/bilibili');

const PRIORITY = { high: 0, medium: 1, low: 2 };
const REVIEW_WORDS = /期末|复习|重点|考点|速成|串讲|真题|突击|不挂科/;

function scopeTerms(task) {
  const scope = task.examScope;
  if (Array.isArray(scope)) return scope.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
  if (typeof scope === 'string' && scope.trim()) return scope.split(/[，,、;；\n]/).map(item => item.trim()).filter(Boolean);
  return [];
}

// Keyword built from real user data only: course name plus the first exam scope
// terms. Nothing is invented when the task has neither.
function keywordFor(task, course) {
  const terms = [course && course.name, ...scopeTerms(task)].filter(Boolean);
  const keyword = (terms.length ? terms.slice(0, 3).join(' ') : task.title).slice(0, 100);
  if (!keyword.trim()) fail('VALIDATION');
  return keyword;
}

function termsFor(task, course) {
  return [course && course.name, ...scopeTerms(task), task.title]
    .filter(term => typeof term === 'string' && term.trim().length >= 2)
    .map(term => term.trim());
}

// Ranking is deliberately explainable: every point comes from something the user
// can see (title wording, duration against remaining minutes, view count).
function scoreItem(item, { terms = [], budgetMinutes = null } = {}) {
  let score = 0;
  const reasons = [];
  if (terms.some(term => item.title.includes(term))) { score += 30; reasons.push('标题命中课程或考点'); }
  if (REVIEW_WORDS.test(item.title)) { score += 12; reasons.push('复习/考点类内容'); }
  const minutes = item.durationSeconds ? item.durationSeconds / 60 : null;
  if (minutes !== null) {
    if (budgetMinutes && minutes <= budgetMinutes) { score += 20; reasons.push('时长在剩余时间内'); }
    if (minutes >= 5 && minutes <= 90) score += 8;
    if (budgetMinutes && minutes > budgetMinutes * 2) { score -= 12; reasons.push('时长明显超出剩余时间'); }
  }
  if (item.play) score += Math.min(Math.log10(item.play + 1) * 4, 20);
  return { score: Math.round(score * 10) / 10, reasons };
}

function rankItems(items, context) {
  return items
    .map(item => { const { score, reasons } = scoreItem(item, context); return { ...item, score, reasons }; })
    .sort((a, b) => b.score - a.score || (a.durationSeconds || 0) - (b.durationSeconds || 0));
}

function pickTargets(tasks, limit) {
  return [...tasks].sort((a, b) => {
    const exam = (b.type === 'exam' ? 1 : 0) - (a.type === 'exam' ? 1 : 0);
    if (exam) return exam;
    const priority = (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1);
    if (priority) return priority;
    const mastery = (a.mastery === 'low' ? 0 : a.mastery === 'medium' ? 1 : 2) - (b.mastery === 'low' ? 0 : b.mastery === 'medium' ? 1 : 2);
    if (mastery) return mastery;
    return String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'));
  }).slice(0, limit);
}

async function recommend({ owner, payload }, deps) {
  const tasks = await deps.repository.list(owner, 'tasks');
  const courses = await deps.repository.list(owner, 'courses');
  const wanted = Array.isArray(payload.taskIds) && payload.taskIds.length ? new Set(payload.taskIds) : null;
  const candidates = tasks.filter(task => ['pending', 'in_progress'].includes(task.status) && (!wanted || wanted.has(task.id)));
  if (!candidates.length) return { source: 'bilibili-search', results: [], note: '没有待处理的任务可推荐' };
  const limitPerTask = Math.min(Math.max(Number(payload.limitPerTask) || 5, 1), 10);
  const targets = pickTargets(candidates, Math.min(Math.max(Number(payload.maxTasks) || 3, 1), 5));
  const search = deps.searchVideos || searchVideos;
  const results = [];
  for (const task of targets) {
    const course = courses.find(item => item.id === task.courseId) || null;
    const keyword = keywordFor(task, course);
    const found = await search({ keyword, limit: limitPerTask + 3 }, deps);
    results.push({
      taskId: task.id,
      taskTitle: task.title,
      keyword,
      fetchedAt: found.fetchedAt,
      items: rankItems(found.items, { terms: termsFor(task, course), budgetMinutes: task.remainingMinutes || null }).slice(0, limitPerTask)
    });
  }
  return { source: 'bilibili-search', results };
}

async function handleResources({ owner, action, payload }, deps) {
  if (action === 'resources.search') {
    const found = await (deps.searchVideos || searchVideos)({ keyword: payload.keyword, limit: payload.limit }, deps);
    return { source: 'bilibili-search', items: rankItems(found.items, { terms: [String(payload.keyword || '').trim()] }), fetchedAt: found.fetchedAt };
  }
  if (action === 'resources.recommend') return recommend({ owner, payload }, deps);
  fail('UNKNOWN_ACTION');
}

module.exports = { handleResources, recommend, rankItems, scoreItem, keywordFor, pickTargets };
