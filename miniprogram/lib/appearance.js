'use strict';
// Display preferences are independent of study data and cloud contracts.
const KEY = 'study_appearance_v1';
const listeners = new Set();
let attached = false;
let systemTheme = 'light';
function read() {
  const saved = wx.getStorageSync(KEY) || {};
  return { mode: ['light', 'dark'].includes(saved.mode) ? saved.mode : 'system', motion: saved.motion !== false };
}
function state() { const value = read(); return { ...value, theme: value.mode === 'system' ? systemTheme : value.mode }; }
function notify() { const value = state(); for (const listener of listeners) listener(value); }
function start() {
  if (attached) return;
  attached = true;
  const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
  systemTheme = info.theme === 'dark' ? 'dark' : 'light';
  if (wx.onThemeChange) wx.onThemeChange(value => { systemTheme = value.theme === 'dark' ? 'dark' : 'light'; notify(); });
}
function subscribe(listener) { start(); listeners.add(listener); listener(state()); return () => listeners.delete(listener); }
function set(patch) { wx.setStorageSync(KEY, { ...read(), ...patch }); notify(); }
function paint(theme) {
  const dark = theme === 'dark', background = dark ? '#000000' : '#F2F2F7';
  if (wx.setNavigationBarColor) wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: background, animation: { duration: read().motion ? 160 : 0, timingFunc: 'easeIn' } });
  if (wx.setBackgroundColor) wx.setBackgroundColor({ backgroundColor: background, backgroundColorTop: background, backgroundColorBottom: background });
}
function bind(page, changed) { return subscribe(value => { page.setData({ theme: value.theme, appearanceMode: value.mode, motionEnabled: value.motion }); paint(value.theme); if (changed) changed(value); }); }
module.exports = { KEY, state, subscribe, set, paint, bind };
