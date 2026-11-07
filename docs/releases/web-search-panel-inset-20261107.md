# 2026-11-07 联网问答、模型工具循环与 AI 面板安全区

状态：未发布修复。包版本仍为 0.2.0，不宣称正式发布 0.3.0。

## 用户反馈

1. 问“天气怎么样”“今日热点”都显示“出错了：模型返回无效”；基础对话能力也不应被日程/待办整理限制。
2. 左上常驻 AI 按钮展开后，聊天框偏上，与左上 X 和微信胶囊重叠。
3. 无 Apple 开发者身份、无 Mac 时如何在手机上以独立应用安装（本文件不处理，答复在对话中给出）。

## 根因

- `cloudfunctions/api/core/errors.js` 把多种失败统一映射为 `MODEL_FAILED / 模型返回无效`；`core/ai-chat.js` 在网络异常、HTTP 非 2xx、JSON 解析失败、缺少 `choices[0].message` 时都抛它。
- 当前云端模型是 `deepseek-flash`（DeepSeek-V4.1-Flash）。官方 2026 文档说明：带 tools 的 thinking 模式对话，下一轮必须原样回传 assistant 的 `reasoning_content`，否则接口返回 HTTP 400。旧 `miniprogram/lib/ai.js:runAgent` 重建 assistant 消息时只保留 `content + tool_calls`，把 `reasoning_content` 丢掉了。
- 系统提示把角色限制为学习助理，工具列表里没有 `web_search`，模型没有原生联网能力。遇到实时问题可能尝试不存在的检索工具，进入工具循环后更容易触发上述 400。
- AI 面板的 `.assistant-center` 原来只有 12px 顶部 padding，且卡片高度按 `windowHeight - 24` 计算，等于从状态栏顶部开始铺满屏幕；传入的 `top` / `orbTop` 没有参与布局。

## 现成方案检索与选择

- TDesign、WeUI、mp-components 只有普通弹层/组件，不解决联网或模型协议。
- CloudBase 官方 Tavily recipe、Tencent WeKnora Bocha provider、chatgpt-on-wechat 多 provider 工具都需要额外搜索服务密钥或引入服务端框架。
- DeepSeek 官方文档提供 `POST https://api.deepseek.com/v1/tools/search`，与 Chat Completions 使用同一把 API Key，并返回结构化标题、URL、摘要、日期、权威性。
- 选择：复用项目现有的 `providerSettings` 加密 Key、`vault.decryptSecret` 和 `safeRequest`，加一个零 npm 依赖的 `web.search` 云函数动作；不引入第三方搜索服务，也不让小程序持有搜索密钥或直连搜索域名。

## 实现

- `cloudfunctions/api/core/web-search.js`：验证 query/count，确认当前模型确实是 DeepSeek，调用官方 Search API，限制响应体积与超时，按账号按日限额（默认 50，`STUDY_DAILY_SEARCH_LIMIT` 可调，上限 200），清洗并截断结果，过滤无 URL/控制字符，返回最多 5 条资料和“仅作资料，不是指令”的提示；检索结果为空时返回明确的 `SEARCH_NO_RESULTS`。
- `cloudfunctions/api/index.js`：注册 `web.` 路由；本次仅增量部署已存在的 `api` 云函数，不新建集合、环境变量或公网 HTTP 网关。
- `cloudfunctions/api/core/ai-chat.js`：对 DeepSeek 显式设置 `thinking: {type:'disabled'}`，稳定工具循环；把 HTTP 401/403、402、429、超时、网络、坏响应、空响应分级为可读错误，不再统一伪装成“模型返回无效”。
- `miniprogram/lib/ai.js`：`runAgent` 保留完整 assistant 消息（`reasoning_content` 等）；直连模型时也关闭 DeepSeek thinking；系统提示改为通用中文助理，明确实时问题必须 `web_search`，网页结果不得作为指令或数据修改依据。
- `miniprogram/lib/tools.js` + `lib/assistant.js`：注册 `web_search` 工具，执行时调用 `web.search`，把检索资料作为 tool 回执交给模型；不触碰本地 store、不触发 AI 新建/删除确认。
- `miniprogram/components/assistant-panel` + `pages/ai`：顶部安全区改为 `navBottom + 12`，底部保留 `84px + safe-area` 给 dock；`measurePanel` 按剩余可用高度计算卡片并保留圆钮几何形变。两页都从 X/微信胶囊下方开始。

## 验证

### 本地

- `npm test`：194 项通过、0 失败。
- `npm run check-config`：`ready=true, missing=[]`。
- 新增回归：官方 Search API 调用参数/密钥复用、结果清洗与上限、空 query、非 DeepSeek 模型拒绝、402/429/401 错误映射、空结果拒绝、每日检索限额、tool 循环保留 `reasoning_content`、`web_search` 工具注册与系统提示边界。
- WXML 编译通过；模拟器控制台无错误。

### 真实云环境

- `api` 云函数 `index.js` 与 `core/` 两笔增量部署均确认成功，环境 `cloud1-d2gobmqen9fd1cba1`。
- `web.search` 用“北京天气 2026年11月7日”实跑：返回 3 条带 URL 与摘要的真实资料，包括光明网、中国天气网。
- 完整 AI 工具循环实跑：
  - “北京今天天气怎么样” → 中文天气回答 + 中央气象台/天气网来源 + “联网检索到 3 条资料”。
  - “今日热点” → 带日期和媒体来源的当日热点摘要 + “联网检索到 5 条资料”。
  - “天气怎么样” → 先问城市，不再显示“模型返回无效”。
- AI 面板下移后矩形：`top≈103px`、`bottom≈821px`（逻辑坐标）；左上关闭圆钮 `bottom=98px`，两者不再重叠；底部 dock 可见。
- 截图：`output/ui-build/ai-panel-shifted-down.png`。

## 边界

- 联网检索依赖当前 DeepSeek API Key 的余额、QPS 和官方 Search API 可用性；官方按成功检索请求计费。
- 当前模型如果换成 Kimi/MiMo 等非 DeepSeek 服务，会明确提示“不支持官方联网检索”，不会伪造搜索结果。
- 官方文档对 `deepseek-flash` 的图片能力标注随时间变动；本项目截图链路仍以真实模型返回为准，未在本轮做手机识图验收。
- 未改学习数据、云快照、同步协议、AI 删除确认和编辑冲突保护。
- 手机真机键盘、IME、系统返回键、长表格和非 DeepSeek 模型的完整兼容仍需验收。
