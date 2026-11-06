'use strict';
module.exports = function createAssistant() {
const ai = require('./ai');
const appearance = require('./appearance');
const shell = require('./shell');
const tools = require('./tools');
const providers = require('./providers');
const cloud = require('./cloud');
const sync = require('./sync');
const KEY = 'study_trial_v1';

// towxml 是第三方大包，加载它本身就可能抛错（体积大、依赖多、解析器在模块顶层组装）。
// 这里的 require 必须被 try 包住：否则一旦加载失败，Page 注册整个失败，页面直接白屏，
// 而 render() 里的 try 根本来不及执行。加载失败时降级为纯文本，AI 页仍然可用。
let towxml = null;
let towxmlError = '';
try {
  towxml = require('../towxml/index');
} catch (error) {
  towxmlError = (error && error.message) || String(error);
  console.error('[ai] towxml 加载失败，Markdown 降级为纯文本：', towxmlError);
}

// Markdown → WXML 节点；解析失败就退回纯文本，不要因为排版把整条消息吞掉。
function render(text, theme) {
  if (!towxml) return null;
  try {
    return towxml(String(text || ''), 'markdown', {theme:theme||'light'});
  } catch (error) {
    return null;
  }
}

function fresh() { return { courses: [], tasks: [], availability: [], blocks: [], unscheduled: [], previous: null }; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

return {
  data: {
    theme: 'light', motionEnabled: true, shell: {navBottom:44,orbTop:0},
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
    this.disposed=false;
    this.setData({shell:shell.layout()});
    this.unbindAppearance=appearance.bind(this,value=>{
      const messages=this.data.messages.map(message=>message.nodes?{...message,nodes:{...message.nodes,theme:value.theme}}:message);
      this.setData({messages});
    });
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
      if (this.data.settings.apiKey) {
        const migrated = await ai.persistSettings(this.data.settings, {cloudAvailable:true,call:cloud.call,setStorage:(k,v)=>wx.setStorageSync(k,v)});
        if(this.disposed)return;
        this.setData({settings:migrated,hasKey:true,notice:'模型配置已迁移到云端，本机明文 Key 已移除'});
        return;
      }
      const remote = await cloud.call('providers.get', {});
      if(this.disposed)return;
      if (remote && remote.keyMasked) {
        const saved={url:remote.url,model:remote.model,apiKey:'',cloudSaved:true};
        wx.setStorageSync(ai.SETTINGS_KEY,saved);
        this.setData({hasKey:true,settings:saved});
      } else {
        this.setData({hasKey:false});
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
    wx.showLoading({title:'保存配置…',mask:true});
    try {
      const saved=await ai.persistSettings(this.data.settings,{cloudAvailable:cloud.available(),call:cloud.call,setStorage:(k,v)=>wx.setStorageSync(k,v)});
      this.setData({settings:saved,hasKey:ai.ready(saved),showSettings:false});
      wx.showToast({title:saved.cloudSaved?'已安全保存到云端':'已保存到本机',icon:'success'});
    } catch(error) {
      this.setData({notice:'保存失败，原配置未变：'+(error.message||error.code)});
    } finally {wx.hideLoading();}
  },
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        if(file.size>1500000){wx.showToast({title:'图片过大，请裁剪后重试',icon:'none'});return;}
        const extension = (file.tempFilePath.split('.').pop() || 'jpg').toLowerCase();
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (read) => {if(read.data.length>2000000){wx.showToast({title:'图片过大，请裁剪后重试',icon:'none'});return;}this.setData({pendingImage:`data:image/${extension==='png'?'png':'jpeg'};base64,${read.data}`});},
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
    if(this.data.sending)return;
    const latest=wx.getStorageSync(KEY);if(latest&&Array.isArray(latest.tasks))this.store=latest;
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
        messages: [{ role: 'system', content: ai.systemPrompt({ date: today(), courses: this.store.courses, tasks: this.store.tasks }) }, ...ai.trimHistory(this.history)],
        request: (history) => ai.requestModel({ settings: this.data.settings, messages: history, tools: tools.TOOLS }),
        execute: async (name, args) => {
          if(this.disposed)return {store:this.store,result:{ok:false,reason:'页面已关闭，未执行操作'}};
          const current=wx.getStorageSync(KEY);if(current&&Array.isArray(current.tasks))this.store=current;
          if(name==='recommend_resources'){
            await sync.flush();
            if(sync.status().dirty)return {store:this.store,result:{ok:false,reason:'请先解决云端同步问题'}};
            try{return {store:this.store,result:{ok:true,...await cloud.call('resources.recommendSnapshot',{})}};}catch(error){return {store:this.store,result:{ok:false,reason:error.code==='BILI_UNAVAILABLE'?'B站暂时无法检索，请稍后重试':error.message}};}
          }
          if(name==='generate_plan'&&cloud.available()){
            sync.save(this.store);try{this.store=await sync.generatePlan();return {store:this.store,result:{ok:this.store.planStatus!=='needs_attention',blocks:this.store.blocks,unscheduled:this.store.unscheduled,reason:this.store.planMessage}};}catch(error){return {store:this.store,result:{ok:false,reason:error.message}};}
          }
          if(name==='create_task'||name==='create_course'){
            const approved=await new Promise(resolve=>wx.showModal({title:'确认 AI 整理结果',content:name==='create_task'?`任务：${args.title||''}\n课程：${args.courseName||'未关联'}\n截止：${args.dueAt||'未提供'}\n预计：${args.remainingMinutes||60} 分钟（估算，可修改）`:`课程：${args.name||''}\n学期：${args.semester||'未提供'}`,success:r=>resolve(Boolean(r.confirm)),fail:()=>resolve(false)}));
            if(!approved)return {store:this.store,result:{ok:false,reason:'用户取消保存，未创建数据'}};
            if(this.disposed)return {store:this.store,result:{ok:false,reason:'页面已关闭，未创建数据'}};
            const current=wx.getStorageSync(KEY);if(current&&Array.isArray(current.tasks))this.store=current;
          }
          const outcome = tools.executeTool(this.store, name, args, { now: new Date().toISOString(), date: this.data.today, id: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7) });
          // 删除不在工具里直接执行：先问用户，确认后才真正移除。
          if (outcome.result && outcome.result.needsConfirmation) {
            const before=this.store.tasks.find(task=>task.id===outcome.result.task.id);
            const approved = await this.confirmDelete(outcome.result.task);
            if (!approved) return { store: this.store, result: { ok: false, reason: '用户取消了删除' } };
            const current=wx.getStorageSync(KEY);if(current&&Array.isArray(current.tasks))this.store=current;
            const after=this.store.tasks.find(task=>task.id===outcome.result.task.id);
            if(this.disposed||JSON.stringify(before)!==JSON.stringify(after))return {store:this.store,result:{ok:false,reason:'任务已变化或页面已关闭，请重新确认删除'}};
            const removed = tools.removeTask(this.store, outcome.result.task.id);
            this.store = require('./study-plan').autoReplan(removed.store,new Date().toISOString());
            sync.save(this.store);
            return removed;
          }
          this.store = outcome.store;
          if(outcome.result&&outcome.result.ok&&name!=='list_tasks'){
            if(name==='create_task'||name==='create_course')this.store=require('./study-plan').autoReplan(this.store,new Date().toISOString());
            sync.save(this.store);
          }
          return outcome;
        }
      });
      if(this.disposed)return;
      this.history = ai.trimHistory(result.history.filter(message=>message.role!=='system'));
      const actions = ai.describeRecords(result.records);
      const appended = [...this.data.messages, { role: 'assistant', text: result.reply || '（模型没有返回内容）', nodes: render(result.reply, this.data.theme) }];
      if (actions.length) appended.push({ role: 'system', text: actions.join('；') });
      this.setData({ messages: appended, sending: false });
    } catch (error) {
      if(this.disposed)return;
      this.setData({ messages: [...this.data.messages, { role: 'system', text: `出错了：${error.message}` }], sending: false });
    }
  },
  onHide(){sync.flush();},
  onShow(){appearance.paint(this.data.theme||'light');},
  onUnload(){if(this.unbindAppearance)this.unbindAppearance();this.disposed=true;sync.flush();},
  explainSettings(){wx.showModal({title:'模型设置',content:cloud.available()?'Key 加密保存在云端。更换服务或模型时重新填写。':'当前为本地模式，Key 保存在设备内。',showCancel:false});},
  useSuggestion(e) {this.setData({input:e.currentTarget.dataset.text});},
  onResize(){this.setData({shell:shell.layout()});},
  back() { if(getCurrentPages().length>1)wx.navigateBack();else wx.reLaunch({url:'/pages/today/index'}); }
};
};
