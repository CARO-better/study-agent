const ai = require('../../lib/ai');
const tools = require('../../lib/tools');
const KEY = 'study_trial_v1';

function fresh() { return { courses: [], tasks: [], availability: [], blocks: [], unscheduled: [], previous: null }; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

Page({
  data: {
    messages: [],
    input: '',
    sending: false,
    showSettings: false,
    settings: { url: '', model: '', apiKey: '' },
    hasKey: false,
    pendingImage: '',
    today: today(),
    notice: ''
  },
  onLoad() {
    const saved = wx.getStorageSync(KEY);
    this.store = saved && saved.courses ? saved : fresh();
    const settings = ai.readSettings(wx.getStorageSync);
    this.setData({ settings, hasKey: ai.ready(settings) });
    this.history = [];
  },
  openSettings() {
    this.setData({ showSettings: true, settings: ai.readSettings(wx.getStorageSync) });
  },
  closeSettings() { this.setData({ showSettings: false }); },
  field(e) { this.setData({ [`settings.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  saveSettings() {
    const saved = ai.saveSettings(wx.setStorageSync, this.data.settings);
    const ok = ai.ready(saved);
    this.setData({ settings: saved, hasKey: ok, showSettings: false });
    wx.showToast({ title: ok ? '已保存' : '还缺 API Key', icon: ok ? 'success' : 'none' });
  },
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        const extension = (file.tempFilePath.split('.').pop() || 'jpg').toLowerCase();
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (read) => this.setData({ pendingImage: `data:image/${extension === 'png' ? 'png' : 'jpeg'};base64,${read.data}` }),
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' })
        });
      }
    });
  },
  clearImage() { this.setData({ pendingImage: '' }); },
  input(e) { this.setData({ input: e.detail.value }); },
  async send() {
    const text = this.data.input.trim();
    const image = this.data.pendingImage;
    if (!text && !image) return;
    if (!this.data.hasKey) {
      wx.showToast({ title: '先在设置里填 API Key', icon: 'none' });
      this.openSettings();
      return;
    }
    const messages = [...this.data.messages, { role: 'user', text: text || '（图片）', image }];
    this.setData({ messages, input: '', pendingImage: '', sending: true, notice: '' });
    const content = ai.buildUserContent({ text, image });
    this.history.push({ role: 'user', content });
    try {
      const result = await ai.runAgent({
        messages: [{ role: 'system', content: ai.systemPrompt({ date: this.data.today, courses: this.store.courses, tasks: this.store.tasks }) }, ...this.history.slice(-10)],
        request: (history) => ai.requestModel({ settings: this.data.settings, messages: history, tools: tools.TOOLS }),
        execute: (name, args) => {
          const outcome = tools.executeTool(this.store, name, args, { now: new Date().toISOString(), date: this.data.today, id: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7) });
          this.store = outcome.store;
          wx.setStorageSync(KEY, this.store);
          return outcome;
        }
      });
      this.history = result.history.slice(-10);
      const actions = ai.describeRecords(result.records);
      const appended = [...this.data.messages, { role: 'assistant', text: result.reply || '（模型没有返回内容）' }];
      if (actions.length) appended.push({ role: 'system', text: actions.join('；') });
      this.setData({ messages: appended, sending: false });
    } catch (error) {
      this.setData({ messages: [...this.data.messages, { role: 'system', text: `出错了：${error.message}` }], sending: false });
    }
  },
  back() { wx.navigateBack(); }
});
