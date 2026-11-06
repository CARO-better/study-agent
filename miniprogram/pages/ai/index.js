const ai = require('../../lib/ai');
const tools = require('../../lib/tools');
const providers = require('../../lib/providers');
const cloud = require('../../lib/cloud');
const KEY = 'study_trial_v1';

// towxml 是第三方大包，加载它本身就可能抛错（体积大、依赖多、解析器在模块顶层组装）。
// 这里的 require 必须被 try 包住：否则一旦加载失败，Page 注册整个失败，页面直接白屏，
// 而 render() 里的 try 根本来不及执行。加载失败时降级为纯文本，AI 页仍然可用。
let towxml = null;
let towxmlError = '';
try {
  towxml = require('../../towxml/index');
} catch (error) {
  towxmlError = (error && error.message) || String(error);
  console.error('[ai] towxml 加载失败，Markdown 降级为纯文本：', towxmlError);
}

// Markdown → WXML 节点；解析失败就退回纯文本，不要因为排版把整条消息吞掉。
function render(text) {
  if (!towxml) return null;
  try {
    return towxml(String(text || ''), 'markdown');
  } catch (error) {
    return null;
  }
}

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
    notice: '',
    presets: providers.PRESETS,
    activePreset: '',
    visionHint: ''
  },
  onLoad() {
    // 初始化任何一步抛错都会让页面停在空白态且没有任何提示，所以整段包起来，
    // 出错时退到可用的空状态，并把原因写进 notice 显示给用户。
    this.history = [];
    try {
      const saved = wx.getStorageSync(KEY);
      this.store = saved && saved.courses ? saved : fresh();
      const settings = ai.readSettings(key => wx.getStorageSync(key));
      this.setData({ settings, hasKey: ai.ready(settings) });
    } catch (error) {
      console.error('[ai] onLoad 初始化失败：', error);
      this.store = fresh();
      const settings = ai.emptySettings();
      this.setData({ settings, hasKey: false, notice: `初始化异常：${(error && error.message) || error}` });
    }
    if (towxmlError) {
      this.setData({ notice: `富文本排版不可用，已降级为纯文本（${towxmlError}）` });
    }
    this.checkCloudProvider();
  },
  // 云端若已存过加密的 Key，清缓存后本地空了也能直接用 —— 界面按「已配置」处理。
  async checkCloudProvider() {
    if (!cloud.available()) return;
    try {
      const remote = await cloud.call('providers.get', {});
      if (remote && remote.keyMasked) {
        this.setData({ hasKey: true });
        if (!this.data.settings.apiKey) {
          this.setData({ settings: Object.assign({}, this.data.settings, { url: remote.url, model: remote.model }) });
        }
      }
    } catch (error) {
      console.warn('[ai] 云端模型配置查询失败：', error && error.code);
    }
  },
  openSettings() {
    const settings = ai.readSettings(key => wx.getStorageSync(key));
    const matched = providers.matchPreset(settings);
    this.setData({
      showSettings: true,
      settings,
      activePreset: matched ? matched.id : 'custom',
      visionHint: matched ? matched.note : ''
    });
  },
  usePreset(e) {
    const id = e.currentTarget.dataset.id;
    if (id === 'custom') {
      this.setData({ activePreset: 'custom', visionHint: '自己填服务地址和模型名，地址必须是公网 HTTPS，并以 /chat/completions 结尾。' });
      return;
    }
    const preset = providers.presetById(id);
    this.setData({ settings: providers.applyPreset(this.data.settings, id), activePreset: id, visionHint: preset ? preset.note : '' });
  },
  closeSettings() { this.setData({ showSettings: false }); },
  field(e) { this.setData({ [`settings.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  async saveSettings() {
    const saved = ai.saveSettings((key, value) => wx.setStorageSync(key, value), this.data.settings);
    const ok = ai.ready(saved);
    this.setData({ settings: saved, hasKey: ok, showSettings: false });
    // 同时把 Key 加密存到云端：清缓存后靠它继续用，前端不再依赖明文 Key。
    if (cloud.available() && saved.apiKey) {
      wx.showLoading({ title: '保存到云端…', mask: true });
      try {
        await cloud.call('providers.save', { url: saved.url, model: saved.model, key: saved.apiKey });
        wx.hideLoading();
        wx.showToast({ title: '已保存到云端', icon: 'success' });
      } catch (error) {
        wx.hideLoading();
        wx.showToast({ title: '本地已存，云端失败：' + ((error && error.code) || ''), icon: 'none' });
      }
      return;
    }
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
  confirmDelete(task) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '删除任务？',
        content: `「${task.title}」删除后无法恢复。`,
        confirmText: '删除',
        confirmColor: '#D64545',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      });
    });
  },
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
        execute: async (name, args) => {
          const outcome = tools.executeTool(this.store, name, args, { now: new Date().toISOString(), date: this.data.today, id: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7) });
          // 删除不在工具里直接执行：先问用户，确认后才真正移除。
          if (outcome.result && outcome.result.needsConfirmation) {
            const approved = await this.confirmDelete(outcome.result.task);
            if (!approved) return { store: this.store, result: { ok: false, reason: '用户取消了删除' } };
            const removed = tools.removeTask(this.store, outcome.result.task.id);
            this.store = removed.store;
            wx.setStorageSync(KEY, this.store);
            return removed;
          }
          this.store = outcome.store;
          wx.setStorageSync(KEY, this.store);
          return outcome;
        }
      });
      this.history = result.history.slice(-10);
      const actions = ai.describeRecords(result.records);
      const appended = [...this.data.messages, { role: 'assistant', text: result.reply || '（模型没有返回内容）', nodes: render(result.reply) }];
      if (actions.length) appended.push({ role: 'system', text: actions.join('；') });
      this.setData({ messages: appended, sending: false });
    } catch (error) {
      this.setData({ messages: [...this.data.messages, { role: 'system', text: `出错了：${error.message}` }], sending: false });
    }
  },
  back() { wx.navigateBack(); }
});
