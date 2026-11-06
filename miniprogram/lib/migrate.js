'use strict';
// 本地试用数据 → 云端记录 的转换，**只做转换与检查，不发任何网络请求**。
//
// 为什么单独一层：本地模型和云端模型有三处硬差异（见上云接入清单），
// 直接对拷会被云端 validate() 拒掉，而且错在哪很难看出来。
// 这一层负责：
//   1. 把 courses[i].semester 字符串聚合成独立的 semesters 记录
//   2. 枚举映射（open→pending、homework→assignment）
//   3. 版本号归一（云端要求整数且更新时匹配）
//   4. 收集「必须先修」的问题，让用户在真正上传前就看到

const STATUS = { open: 'pending', completed: 'completed', cancelled: 'cancelled', in_progress: 'in_progress' };
const TYPE = { homework: 'assignment', experiment: 'experiment', exam: 'exam', other: 'other', group: 'group', study: 'study' };
const PRIORITY = { low: 'low', medium: 'medium', high: 'high' };

// 后端 core/records.js 的硬约束，这里复制一份用于预检（不能直接 require 云函数模块，
// 它依赖 node: 内置模块，前端环境跑不了）。
const LIMITS = {
  titleMax: 300,
  courseNameMax: 100,
  semesterNameMax: 100,
  noteMax: 10000,
  minutesMax: 100000,
  teachingWeeksMax: 60
};

function pad(n) { return String(n).padStart(2, '0'); }
function isDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }

// 云函数把所有内部异常都压成 INTERNAL，直接透给用户等于没说。
// 写操作一律走 repository.transaction()，而事务开头要写 ownerLocks 做并发闸门，
// 所以「能读不能写」几乎总是 ownerLocks 集合没建。
function describeError(error) {
  const code = (error && error.code) || '';
  const message = (error && error.message) || String(error);
  if (code === 'INTERNAL') {
    return `INTERNAL ${message}（写操作走事务，事务需要 ownerLocks 集合；确认云开发控制台里已创建它）`;
  }
  if (code === 'VALIDATION') return `VALIDATION ${message}（字段不符合后端规则，看预览里的问题清单）`;
  if (code === 'CONFLICT') return `CONFLICT ${message}（云端已有同一条记录）`;
  return `${code} ${message}`.trim();
}

// 从「2026秋」「2026-2027学年第一学期」这类字符串里推断学期区间。
// 推断不出来的返回 null，交给调用方提示用户补填 —— 不编造日期。
function inferTerm(name) {
  const text = String(name || '');
  const year = (text.match(/(20\d{2})/) || [])[1];
  if (!year) return null;
  const y = Number(year);
  const isAutumn = /(秋|第一学期|上学期|上|1学期|Ⅰ)/.test(text);
  const isSpring = /(春|第二学期|下学期|下|2学期|Ⅱ)/.test(text);
  if (isAutumn && !isSpring) return { startDate: `${y}-09-01`, endDate: `${y + 1}-01-15`, teachingWeeks: 20 };
  if (isSpring && !isAutumn) return { startDate: `${y}-02-20`, endDate: `${y}-07-10`, teachingWeeks: 20 };
  // 只有年份、没有学期特征：按当前月份猜，并标记为「推断」
  const month = new Date().getMonth() + 1;
  if (month >= 8 || month === 1) return { startDate: `${y}-09-01`, endDate: `${y + 1}-01-15`, teachingWeeks: 20, guessed: true };
  return { startDate: `${y}-02-20`, endDate: `${y}-07-10`, teachingWeeks: 20, guessed: true };
}

function buildPlan(store) {
  const source = store && typeof store === 'object' ? store : {};
  const localCourses = Array.isArray(source.courses) ? source.courses : [];
  const localTasks = Array.isArray(source.tasks) ? source.tasks : [];
  const problems = [];
  const notes = [];

  // ---- 1. 学期：把课程上的学期字符串聚合成独立记录 ----
  const termNames = [];
  for (const course of localCourses) {
    const name = String(course && course.semester || '').trim();
    if (name && !termNames.includes(name)) termNames.push(name);
  }
  if (!termNames.length && localCourses.length) {
    problems.push('课程没有填写学期名，云端要求每门课都挂在学期下。先在「课程」里补上学期的名称。');
  }

  const semesters = termNames.map(name => {
    const range = inferTerm(name);
    if (!range) {
      problems.push(`学期「${name}」推断不出起止日期（需要有 4 位年份），上传前必须补 startDate / endDate / teachingWeeks。`);
      return { name, startDate: '', endDate: '', teachingWeeks: 20, needManualFill: true };
    }
    if (range.guessed) notes.push(`学期「${name}」只有年份、没有「秋/春」字样，日期是按当前月份推断的（${range.startDate} ~ ${range.endDate}），可在云端再改。`);
    if (name.length > LIMITS.semesterNameMax) problems.push(`学期名「${name}」超过 ${LIMITS.semesterNameMax} 字。`);
    return { name, startDate: range.startDate, endDate: range.endDate, teachingWeeks: range.teachingWeeks };
  });

  // ---- 2. 课程 ----
  const courses = localCourses.map(course => {
    const name = String(course && course.name || '').trim();
    const semesterName = String(course && course.semester || '').trim();
    if (!name) problems.push(`有课程缺少名称（本地 id ${course && course.id}），会被跳过。`);
    if (name && !semesterName) problems.push(`课程「${name}」没有填写学期名，云端 semesterId 是必填，上传会失败。`);
    if (name.length > LIMITS.courseNameMax) problems.push(`课程名「${name}」超过 ${LIMITS.courseNameMax} 字。`);
    return {
      localId: course && course.id,
      record: {
        name,
        semesterName,
        teacher: String(course && course.teacher || ''),
        notes: String(course && course.notes || ''),
        schedule: []   // 本地没有周课表结构，留空，后续可补
      }
    };
  }).filter(item => item.record.name);

  // ---- 3. 任务 ----
  const courseById = new Map(localCourses.map(c => [c && c.id, c]));
  const tasks = localTasks.map(task => {
    const title = String(task && task.title || '').trim();
    if (!title) { problems.push(`有任务缺少标题（本地 id ${task && task.id}），会被跳过。`); return null; }
    if (title.length > LIMITS.titleMax) problems.push(`任务标题「${title}」超过 ${LIMITS.titleMax} 字。`);

    const minutes = Number(task.remainingMinutes);
    const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.min(LIMITS.minutesMax, Math.round(minutes))) : 0;

    const type = TYPE[task.type];
    if (!type) problems.push(`任务「${title}」的类型「${task.type}」云端不认，会按 other 上传。`);

    const status = STATUS[task.status];
    if (!status) problems.push(`任务「${title}」的状态「${task.status}」云端不认，会按 pending 上传。`);

    const dueAt = task.dueAt && isDate(task.dueAt) ? task.dueAt : null;
    if (task.dueAt && !isDate(task.dueAt)) problems.push(`任务「${title}」的截止日期「${task.dueAt}」不是 YYYY-MM-DD，会按无截止上传。`);

    // 课程必须能解析到本地课程；解析不到就断开关联，而不是让整条记录失败
    const localCourse = task.courseId ? courseById.get(task.courseId) : null;
    if (task.courseId && !localCourse) notes.push(`任务「${title}」关联的课程已不存在，上传时会解除关联。`);

    return {
      localId: task.id,
      localCourseId: localCourse ? task.courseId : '',
      record: {
        title,
        type: type || 'other',
        status: status || 'pending',
        dueAt,
        remainingMinutes: safeMinutes,
        priority: PRIORITY[task.priority] || undefined
      }
    };
  }).filter(Boolean);

  return {
    semesters,
    courses,
    tasks,
    problems,
    notes,
    summary: {
      semesters: semesters.length,
      courses: courses.length,
      tasks: tasks.length,
      skippedCourses: localCourses.length - courses.length,
      skippedTasks: localTasks.length - tasks.length
    }
  };
}

// 生成给用户看的预览文本：数量 + 样例 + 必须先修的问题
function describePlan(plan) {
  const lines = [];
  const s = plan.summary;
  lines.push(`学期 ${s.semesters} 个 · 课程 ${s.courses} 门 · 任务 ${s.tasks} 条`);
  if (s.skippedCourses || s.skippedTasks) {
    lines.push(`（有 ${s.skippedCourses} 门课程、${s.skippedTasks} 条任务因为缺必填字段会被跳过）`);
  }
  if (plan.semesters[0]) {
    const t = plan.semesters[0];
    lines.push(`学期样例：${t.name} ${t.startDate || '？'} ~ ${t.endDate || '？'} 共 ${t.teachingWeeks} 周`);
  }
  if (plan.tasks[0]) {
    const t = plan.tasks[0].record;
    lines.push(`任务样例：${t.title} / ${t.type} / ${t.status} / ${t.dueAt || '无截止'} / ${t.remainingMinutes} 分钟`);
  }
  if (plan.problems.length) {
    lines.push('');
    lines.push(`有 ${plan.problems.length} 个问题必须先解决：`);
    plan.problems.slice(0, 3).forEach(p => lines.push('· ' + p));
    if (plan.problems.length > 3) lines.push(`· 还有 ${plan.problems.length - 3} 条，见控制台`);
  }
  return lines.join('\n');
}

// ---- 真正上传 ----
// 顺序不能换：synced 必须 semesters → courses → tasks。
// 云端的 references() 会校验 courseId/semesterId 是否存在，反序直接 INVALID_REFERENCE。
// 每建一条都把后端返回的 id 记下来，供下一层引用 —— 因为后端用 randomUUID 自己生成 id，
// 前端传的 id 会被 select() 丢掉，两边 id 体系不通。
//
// call 由调用方注入（cloud.call），这样本文件不依赖网络层，可以单测。
async function upload(plan, deps = {}) {
  const call = deps.call;
  if (typeof call !== 'function') throw new Error('upload 需要一个 call(action, payload) 函数');
  const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : () => {};

  const report = { semesters: 0, courses: 0, tasks: 0, errors: [], semesterIdByName: {}, courseIdByLocalId: {}, uploadedAt: new Date().toISOString() };
  const total = plan.semesters.length + plan.courses.length + plan.tasks.length;
  let done = 0;
  const step = label => { done += 1; onProgress({ done, total, label }); };

  // 1. 学期
  for (const term of plan.semesters) {
    if (term.needManualFill || !term.startDate || !term.endDate) {
      report.errors.push(`学期「${term.name}」缺起止日期，已跳过，它下面的课程和任务也不会传。`);
      step(`学期 ${term.name} 跳过`);
      continue;
    }
    try {
      const created = await call('semesters.create', {
        record: { name: term.name, startDate: term.startDate, endDate: term.endDate, teachingWeeks: term.teachingWeeks }
      });
      report.semesterIdByName[term.name] = created.id;
      report.semesters += 1;
      step(`学期 ${term.name}`);
    } catch (error) {
      report.errors.push(`学期「${term.name}」失败：${describeError(error)}`);
      step(`学期 ${term.name} 失败`);
    }
  }

  // 2. 课程
  for (const course of plan.courses) {
    const semesterId = report.semesterIdByName[course.record.semesterName];
    if (!semesterId) {
      report.errors.push(`课程「${course.record.name}」找不到学期「${course.record.semesterName}」，已跳过。`);
      step(`课程 ${course.record.name} 跳过`);
      continue;
    }
    try {
      const created = await call('courses.create', {
        record: {
          name: course.record.name,
          semesterId,
          teacher: course.record.teacher || undefined,
          notes: course.record.notes || undefined,
          schedule: []
        }
      });
      report.courseIdByLocalId[course.localId] = created.id;
      report.courses += 1;
      step(`课程 ${course.record.name}`);
    } catch (error) {
      report.errors.push(`课程「${course.record.name}」失败：${describeError(error)}`);
      step(`课程 ${course.record.name} 失败`);
    }
  }

  // 3. 任务
  for (const task of plan.tasks) {
    const courseId = task.localCourseId ? report.courseIdByLocalId[task.localCourseId] : null;
    try {
      const record = { ...task.record };
      // 课程没传成功时，任务仍然上传，只是解除关联 —— 不能因为一门课失败丢掉整批任务。
      if (courseId) record.courseId = courseId;
      await call('tasks.create', { record });
      report.tasks += 1;
      step(`任务 ${task.record.title}`);
    } catch (error) {
      report.errors.push(`任务「${task.record.title}」失败：${describeError(error)}`);
      step(`任务 ${task.record.title} 失败`);
    }
  }

  return report;
}

// ---- 从云端拉回本地 ----
// 清缓存 / 换手机后，本地 store 是空的，但云端还在。这个函数把云端三个集合
// 还原成本地 store 的形状，让页面能直接 setData。
//
// 注意三件事：
//   1. 云端的 id 是 UUID，直接当本地 id 用（本地不关心 id 长什么样）
//   2. 本地 courses.semester 是字符串，云端是 semesterId 引用 → 要反查 semesters 的名字
//   3. 排期结果（blocks/unscheduled/availability）不在云端，恢复后是空的，需要重新生成
const STATUS_SERVER_TO_LOCAL = { pending: 'open', in_progress: 'open', completed: 'completed', cancelled: 'open' };
const TYPE_SERVER_TO_LOCAL = { assignment: 'homework', experiment: 'experiment', exam: 'exam', group: 'other', study: 'other', other: 'other' };

async function restore(deps = {}) {
  const call = deps.call;
  if (typeof call !== 'function') throw new Error('restore 需要一个 call(action, payload) 函数');

  // 三个列表互不依赖，并行拉，减少等待
  const [semesters, courses, tasks] = await Promise.all([
    call('semesters.list', { query: {} }),
    call('courses.list', { query: {} }),
    call('tasks.list', { query: {} })
  ]);

  const termNameById = new Map((semesters || []).map(s => [s.id, s.name]));
  const courseIds = new Set((courses || []).map(c => c.id));

  const localCourses = (courses || []).map(c => ({
    id: c.id,
    name: c.name,
    semester: termNameById.get(c.semesterId) || '',
    teacher: c.teacher || '',
    notes: c.notes || ''
  }));

  const localTasks = (tasks || []).map(t => ({
    id: t.id,
    title: t.title,
    // 课程在云端被删过时不要留一个指向空气的 id，否则删任务时会一起出问题
    courseId: t.courseId && courseIds.has(t.courseId) ? t.courseId : '',
    type: TYPE_SERVER_TO_LOCAL[t.type] || 'other',
    status: STATUS_SERVER_TO_LOCAL[t.status] || 'open',
    // 本地只认 YYYY-MM-DD；云端可能存了带时间的 ISO 串
    dueAt: t.dueAt ? String(t.dueAt).slice(0, 10) : '',
    remainingMinutes: Number.isFinite(t.remainingMinutes) ? t.remainingMinutes : 0,
    priority: t.priority || 'medium',
    version: Number.isInteger(t.version) ? t.version : 0
  }));

  return {
    courses: localCourses,
    tasks: localTasks,
    semesterCount: (semesters || []).length,
    skippedCourses: 0
  };
}

module.exports = { buildPlan, describePlan, upload, restore, inferTerm, LIMITS, STATUS, TYPE };
