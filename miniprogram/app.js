const { envId } = require('./config');
const appearance = require('./lib/appearance');

App({
  globalData: {
    // 云端是否可用由 config.envId 决定；未配置时整个界面按本地试用模式工作。
    cloudReady: false,
    envId: ''
  },
  onLaunch() {
    appearance.subscribe(value => { this.globalData.theme = value.theme; appearance.paint(value.theme); });
    if (!envId) {
      console.info('[study-agent] 未填写云环境 ID，当前为本地试用模式，数据只保存在本机。');
      return;
    }
    if (!wx.cloud) {
      console.error('[study-agent] 当前基础库低于 2.2.3，无法使用云开发，请升级微信开发者工具。');
      return;
    }
    wx.cloud.init({ env: envId, traceUser: true });
    this.globalData.cloudReady = true;
    this.globalData.envId = envId;
  }
});
