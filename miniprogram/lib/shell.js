'use strict';

function layout() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
  const statusBarHeight = Math.max(0, Number(info.statusBarHeight) || 0);
  const rect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
  const valid = rect && rect.top >= statusBarHeight && rect.height > 0 && rect.bottom > rect.top;
  const barHeight = valid ? Math.max(44, (rect.top - statusBarHeight) * 2 + rect.height) : 44;
  return {statusBarHeight, navBottom: statusBarHeight + barHeight, orbTop: statusBarHeight + (barHeight - 44) / 2};
}

function taskMeta(task, courseName) {
  return [task.courseId ? courseName : '', task.dueAt || '', task.remainingMinutes > 0 ? task.remainingMinutes + ' 分钟' : ''].filter(Boolean).join(' · ');
}

module.exports = {layout, taskMeta};
