'use strict';
// AI 能对本地数据做的动作。纯函数：输入当前 store，输出新 store + 给模型看的回执。
// 页面只负责调用、保存、渲染，所以这些规则可以在 node 里直接测。

const TYPE_INDEX = { homework: 0, experiment: 1, exam: 2, other: 3 };
const PRIORITY_INDEX = { low: 0, medium: 1, high: 2 };

function uid(seed) {
  return `${seed}${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function findCourse(store, name) {
  const target = normalize(name);
  if (!target) return null;
  return store.courses.find(course => normalize(course.name) === target)
    || store.courses.find(course => normalize(course.name).includes(target) || target.includes(normalize(course.name)))
    || null;
}

function findTask(store, title) {
  const target = normalize(title);
  const open = store.tasks.filter(task => task.status !== 'completed');
  return open.find(task => normalize(task.title) === target)
    || open.find(task => normalize(task.title).includes(target))
    || null;
}

// 模糊匹配：先找完全同名的，再退到"包含"。多条命中时返回候选，交给用户选，
// 不替用户决定删哪一条。
function findTaskCandidates(store, title) {
  const target = normalize(title);
  if (!target) return [];
  const exact = store.tasks.filter(task => normalize(task.title) === target);
  if (exact.length) return exact;
  return store.tasks.filter(task => {
    const name = normalize(task.title);
    return name.includes(target) || target.includes(name);
  });
}

function brief(task) {
  return { id: task.id, title: task.title, dueAt: task.dueAt || null, status: task.status || 'open' };
}

function createTask(store, args, { now, id }) {
  const title = String(args.title || '').trim();
  if (!title) return { store, result: { ok: false, reason: '缺少任务标题' } };
  if (title.length > 300) return { store, result: { ok: false, reason: '标题过长' } };
  const course = args.courseName ? findCourse(store, args.courseName) : null;
  const type = TYPE_INDEX[args.type] !== undefined ? args.type : 'homework';
  const priority = PRIORITY_INDEX[args.priority] !== undefined ? args.priority : 'medium';
  const minutes = Number.isInteger(args.remainingMinutes) && args.remainingMinutes > 0 ? args.remainingMinutes : 60;
  const dueAt = typeof args.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dueAt) ? args.dueAt : '';
  const task = {
    id: id(),
    title,
    courseId: course ? course.id : '',
    type,
    typeIndex: TYPE_INDEX[type],
    priority,
    priorityIndex: PRIORITY_INDEX[priority],
    dueAt,
    remainingMinutes: minutes,
    status: 'open',
    version: 1,
    createdAt: now
  };
  const exists = store.tasks.find(item => normalize(item.title) === normalize(title) && item.status !== 'completed');
  if (exists) return { store, result: { ok: false, reason: `已有同名未完成任务「${exists.title}」，未重复创建` } };
  return {
    store: { ...store, tasks: [...store.tasks, task] },
    result: { ok: true, id: task.id, task: { title, courseName: course ? course.name : null, dueAt: dueAt || null, minutes, priority } }
  };
}

function createCourse(store, args, { id }) {
  const name = String(args.name || '').trim();
  const semester = String(args.semester || '').trim();
  if (!name) return { store, result: { ok: false, reason: '缺少课程名称' } };
  if (store.courses.some(course => normalize(course.name) === normalize(name))) {
    return { store, result: { ok: false, reason: `课程「${name}」已存在` } };
  }
  const course = { id: id(), name, semester };
  return { store: { ...store, courses: [...store.courses, course] }, result: { ok: true, id: course.id, course: { name, semester } } };
}

function updateTaskStatus(store, args) {
  const task = findTask(store, args.title);
  if (!task) return { store, result: { ok: false, reason: `找不到未完成任务「${args.title || ''}」` } };
  const status = args.status === 'open' ? 'open' : 'completed';
  return {
    store: { ...store, tasks: store.tasks.map(item => (item.id === task.id ? { ...item, status, version: (item.version || 0) + 1 } : item)) },
    result: { ok: true, id: task.id, title: task.title, status }
  };
}

// 删除分两步：工具本身不动数据，只说明命中了哪一条；页面弹确认框后调 removeTask。
function deleteTask(store, args) {
  const title = String(args.title || '').trim();
  if (!title) return { store, result: { ok: false, reason: '缺少要删除的任务标题' } };
  const matches = findTaskCandidates(store, title);
  if (!matches.length) return { store, result: { ok: false, reason: `找不到任务「${title}」，可以先让我列一下` } };
  if (matches.length > 1) {
    return {
      store,
      result: { ok: false, ambiguous: true, reason: '有多条任务匹配，需要用户确认删哪一条', candidates: matches.slice(0, 5).map(brief) }
    };
  }
  return { store, result: { ok: false, needsConfirmation: true, reason: '删除需要用户在界面上确认', task: brief(matches[0]) } };
}

function removeTask(store, id) {
  const task = store.tasks.find(item => item.id === id);
  if (!task) return { store, result: { ok: false, reason: '任务已不存在，可能已被删除' } };
  return {
    store: {
      ...store,
      tasks: store.tasks.filter(item => item.id !== id),
      blocks: (store.blocks || []).filter(block => block.taskId !== id),
      unscheduled: (store.unscheduled || []).filter(entry => entry.taskId !== id)
    },
    result: { ok: true, id, title: task.title }
  };
}

function listTasks(store, args, { date }) {
  const open = store.tasks.filter(task => task.status !== 'completed');
  const scope = args && args.scope;
  const filtered = scope === 'overdue' ? open.filter(task => task.dueAt && task.dueAt < date)
    : scope === 'today' ? open.filter(task => task.dueAt === date)
      : open;
  return {
    store,
    result: {
      ok: true,
      count: filtered.length,
      tasks: filtered.slice(0, 30).map(task => ({
        title: task.title,
        course: (store.courses.find(course => course.id === task.courseId) || {}).name || null,
        dueAt: task.dueAt || null,
        priority: task.priority || 'medium',
        overdue: Boolean(task.dueAt && task.dueAt < date)
      }))
    }
  };
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '在应用里创建一条待办任务。用户说“加个作业/提醒我交报告”时使用。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: '任务标题，取自用户原话或截图内容，不要编造' },
          courseName: { type: 'string', description: '关联课程名称；不确定就不要传' },
          dueAt: { type: 'string', description: '截止日期 YYYY-MM-DD；截图或原话里没有就留空，不要猜' },
          type: { type: 'string', enum: ['homework', 'experiment', 'exam', 'other'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          remainingMinutes: { type: 'integer', description: '预计需要多少分钟；没依据就省略，默认 60' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_course',
      description: '新增一门课程。',
      parameters: {
        type: 'object',
        required: ['name', 'semester'],
        properties: { name: { type: 'string' }, semester: { type: 'string', description: '例如 2026 秋季' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: '把某条未完成任务标记为已完成，或重新打开。',
      parameters: {
        type: 'object',
        required: ['title', 'status'],
        properties: { title: { type: 'string' }, status: { type: 'string', enum: ['completed', 'open'] } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: '删除一条任务。工具不会直接删除：会返回 needsConfirmation 或候选列表，需要用户在界面上确认。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string', description: '要删除的任务标题，尽量用用户说的原话' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '查询当前未完成任务，用于回答“我还有哪些事”。',
      parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['all', 'today', 'overdue'] } } }
    }
  }
];

function executeTool(store, name, args, context) {
  const input = args && typeof args === 'object' ? args : {};
  if (name === 'create_task') return createTask(store, input, context);
  if (name === 'create_course') return createCourse(store, input, context);
  if (name === 'update_task_status') return updateTaskStatus(store, input);
  if (name === 'delete_task') return deleteTask(store, input);
  if (name === 'list_tasks') return listTasks(store, input, context);
  return { store, result: { ok: false, reason: `不支持的动作 ${name}` } };
}

module.exports = { TOOLS, executeTool, removeTask, findCourse, findTask, findTaskCandidates, TYPE_INDEX, PRIORITY_INDEX };
