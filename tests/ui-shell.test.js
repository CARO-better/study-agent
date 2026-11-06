'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

function page() {
  let definition, sheet;
  const navigation = [];
  global.wx = {showActionSheet(value) {sheet = value;}, navigateTo: value => navigation.push(value)};
  global.Page = value => {definition = value;};
  delete require.cache[require.resolve('../miniprogram/pages/today/index')];
  require('../miniprogram/pages/today/index');
  const instance = {...definition, data: structuredClone(definition.data), setData(value) {Object.assign(this.data, value);}};
  return {instance, navigation, choose(index) {sheet.success({tapIndex: index});}, cancel() {if (sheet.fail) sheet.fail({errMsg: 'cancel'});}};
}

test('AI opens above the current section and closes without navigating away', () => {
  const h = page(), p = h.instance;
  p.data.tab = '课程'; p.data.editing = 'course';
  p.openAI();
  assert.equal(p.data.showAssistant, true); assert.equal(p.data.editing, 'course','opening AI preserves the current unsaved form');
  assert.equal(p.data.tab, '课程'); assert.equal(h.navigation.length, 0);
  let refreshed=0;p.onShow = () => {refreshed++;};
  p.openAI(); assert.equal(p.data.showAssistant, false); assert.equal(p.data.tab, '课程');
  assert.equal(refreshed,1,'closing via the persistent orb must refresh tasks changed by AI');
});

test('task menu dispatches the selected record and cancellation performs no mutation', () => {
  const h = page(), p = h.instance, calls = [];
  assert.equal(typeof p.taskActions, 'function');
  p.openTask = event => calls.push(['edit', event.currentTarget.dataset.id]);
  p.recommend = event => calls.push(['resources', event.currentTarget.dataset.id]);
  p.remove = event => calls.push(['delete', event.currentTarget.dataset.kind, event.currentTarget.dataset.id]);
  const event = {currentTarget: {dataset: {id: 'task-7'}}};
  p.taskActions(event); h.cancel(); assert.deepEqual(calls, []);
  p.taskActions(event); h.choose(0);
  p.taskActions(event); h.choose(1);
  p.taskActions(event); h.choose(2);
  assert.deepEqual(calls, [['edit', 'task-7'], ['resources', 'task-7'], ['delete', 'task', 'task-7']]);
});

test('quick add follows the current section and plan creation offers both time types', () => {
  const h = page(), p = h.instance, calls = [];
  assert.equal(typeof p.quickAdd, 'function');
  p.openTask = () => calls.push('task'); p.openCourse = () => calls.push('course');
  p.openAvailability = () => calls.push('available'); p.openFixedTime = () => calls.push('fixed');
  p.data.tab = '今日'; p.quickAdd(); p.data.tab = '课程'; p.quickAdd();
  p.data.tab = '计划'; p.quickAdd(); h.choose(0); p.quickAdd(); h.choose(1);
  assert.deepEqual(calls, ['task', 'course', 'available', 'fixed']);
});

test('custom navigation positions the AI touch target below the status bar', () => {
  const h = page(), p = h.instance;
  assert.equal(typeof p.onResize, 'function');
  global.wx.getWindowInfo = () => ({statusBarHeight: 59});
  global.wx.getMenuButtonBoundingClientRect = () => ({top: 65, bottom: 97, height: 32, left: 290});
  p.onResize();
  assert.ok(p.data.shell.orbTop >= 59); assert.ok(p.data.shell.navBottom >= p.data.shell.orbTop + 44);
  global.wx.getWindowInfo = () => ({statusBarHeight: 20});
  global.wx.getMenuButtonBoundingClientRect = () => ({top: 0, bottom: 0, height: 0});
  p.onResize(); assert.equal(p.data.shell.navBottom, 64); assert.equal(p.data.shell.orbTop, 20);
});
