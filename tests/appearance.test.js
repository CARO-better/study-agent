'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function appearance(saved, systemTheme = 'light') {
  const storage = {study_trial_v1: {tasks: [{id: 'keep'}]}, study_appearance_v1: saved};
  const bars = [], handlers = [];
  const context = {module: {exports: {}}, wx: {
    getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
    getAppBaseInfo: () => ({theme: systemTheme}), onThemeChange: handler => handlers.push(handler),
    setNavigationBarColor: options => bars.push(options), setBackgroundColor() {}
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/lib/appearance.js'), 'utf8'), context);
  return {api: context.module.exports, storage, bars, handlers};
}

test('appearance follows the system and notifies all subscribed pages with one OS listener', () => {
  const {api, handlers} = appearance(undefined, 'dark'), first = [], second = [];
  api.subscribe(value => first.push(value)); api.subscribe(value => second.push(value));
  assert.equal(handlers.length, 1); assert.equal(first[0].theme, 'dark');
  handlers[0]({theme: 'light'});
  assert.equal(first.at(-1).theme, 'light'); assert.equal(second.at(-1).theme, 'light');
});

test('manual theme survives OS changes, returns to system, and persists independently of learning data', () => {
  const {api, storage, handlers} = appearance(), values = [];
  const before = JSON.stringify(storage.study_trial_v1);
  api.subscribe(value => values.push(value)); api.set({mode: 'dark', motion: false});
  handlers[0]({theme: 'light'}); assert.equal(values.at(-1).theme, 'dark');
  api.set({mode: 'system'}); assert.equal(values.at(-1).theme, 'light');
  assert.equal(values.at(-1).motion, false); assert.equal(JSON.stringify(storage.study_trial_v1), before);
  assert.equal(appearance(storage.study_appearance_v1).api.state().motion, false);
});

test('unloaded pages stop receiving appearance updates', () => {
  const {api} = appearance(); let calls = 0;
  const unsubscribe = api.bind({setData() { calls++; }});
  assert.equal(calls, 1); unsubscribe(); api.set({mode: 'dark'}); assert.equal(calls, 1);
});

test('reduced motion removes native navigation transitions too', () => {
  const {api, bars} = appearance({motion: false});
  api.paint('dark'); assert.equal(bars.at(-1).animation.duration, 0);
  assert.equal(bars.at(-1).frontColor, '#ffffff');
});

function motion({enabled = true, pixelRatio = 3, missingCanvas = false} = {}) {
  let definition, query, options; const events = {}, calls = [], timers = new Map();
  const canvas = {getContext: () => ({})};
  const animation = {
    addEventListener: (name, fn) => { events[name] = fn; },
    play: () => calls.push('play'), pause: () => calls.push('pause'),
    goToAndStop: frame => calls.push(['static', frame]), destroy: () => calls.push('destroy')
  };
  const context = {Component: value => {definition = value;}, console, wx: {getWindowInfo: () => ({pixelRatio})},
    setTimeout: fn => {const id = timers.size + 1; timers.set(id, fn); return id;}, clearTimeout: id => timers.delete(id),
    require: name => name.includes('vendor/lottie') ? {setup() {}, loadAnimation(value) {options = value; return animation;}} : {ip: 0, op: 48}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/components/study-motion/index.js'), 'utf8'), context);
  const instance = {...definition.methods, properties: {enabled}, data: {ready: false},
    setData(value) {Object.assign(this.data, value);},
    createSelectorQuery() {return {select() {return this;}, fields() {return this;}, exec(fn) {query = fn;}};}
  };
  definition.lifetimes.attached.call(instance); definition.lifetimes.ready.call(instance);
  const resolve = () => query(missingCanvas ? [] : [{node: canvas, width: 72, height: 72}]);
  return {definition, instance, events, calls, timers, canvas, resolve, options: () => options};
}

test('Lottie receives high resolution backing pixels without applying pixel density twice', () => {
  const h = motion(); h.resolve();
  assert.equal(h.canvas.width, 216); assert.equal(h.canvas.height, 216);
  // This adapter computes its viewport from context.canvas.width, already in backing pixels.
  assert.equal(h.options().rendererSettings.dpr, 1);
});

test('disabled Lottie renders a complete static frame and never autoplays', () => {
  const h = motion({enabled: false}); h.resolve(); h.events.DOMLoaded();
  assert.equal(h.options().autoplay, false); assert.equal(h.instance.data.ready, true);
  assert.equal(h.calls.some(call => call === 'play'), false);
  assert.equal(h.calls.at(-1)[0], 'static'); assert.equal(h.calls.at(-1)[1], 47);
});

test('Lottie resumes after page return but stays paused while hidden or after completing', () => {
  const h = motion(); h.resolve(); h.events.DOMLoaded();
  h.definition.pageLifetimes.hide.call(h.instance);
  const plays = h.calls.filter(call => call === 'play').length;
  h.definition.observers.enabled.call(h.instance, true);
  assert.equal(h.calls.filter(call => call === 'play').length, plays);
  h.definition.pageLifetimes.show.call(h.instance);
  assert.equal(h.calls.filter(call => call === 'play').length, plays + 1);
  h.events.complete(); h.definition.pageLifetimes.hide.call(h.instance); h.definition.pageLifetimes.show.call(h.instance);
  assert.equal(h.calls.filter(call => call === 'play').length, plays + 1);
});

test('switching off motion mid-animation shows the final frame', () => {
  const h = motion(); h.resolve(); h.events.DOMLoaded(); h.instance.properties.enabled = false;
  h.definition.observers.enabled.call(h.instance, false);
  assert.equal(h.calls.at(-1)[0], 'static'); assert.equal(h.calls.at(-1)[1], 47);
});

test('failed or stalled Lottie returns to its static illustration and frees the animation', () => {
  for (const failure of ['data_failed', 'error', 'timeout']) {
    const h = motion(); h.resolve();
    if (failure === 'timeout') {assert.ok(h.timers.size); [...h.timers.values()][0]();}
    else h.events[failure]();
    assert.equal(h.instance.data.ready, false); assert.equal(h.calls.at(-1), 'destroy');
    assert.equal(h.instance.animation, null);
  }
});

test('unmounted or unsupported canvas keeps the fallback without creating a late animation', () => {
  const h = motion(); h.definition.lifetimes.detached.call(h.instance); h.resolve();
  assert.equal(h.options(), undefined);
  const missing = motion({missingCanvas: true}); missing.resolve(); assert.equal(missing.instance.data.ready, false);
});

test('destroying Lottie clears the pending readiness timeout', () => {
  const h = motion(); h.resolve(); h.definition.lifetimes.detached.call(h.instance);
  assert.equal(h.timers.size, 0); assert.equal(h.calls.at(-1), 'destroy');
  h.events.DOMLoaded(); assert.equal(h.instance.data.ready, false);
});
