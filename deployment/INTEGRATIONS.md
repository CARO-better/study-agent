# 外部链路及配置（Task 1）

本目录尚未部署。`npm run check-config -- deployment/config.local.json` 只检查本地公开身份字段，不调用任何网络服务，不读取进程凭据。返回 `ready: true` 仅说明 `envId`、`appId` 形式合格，不等于账号可用、云环境存在或服务已经连通。样例默认检查失败（退出码 1）是预期结果。

复制 `config.example.json` 为已忽略的 `config.local.json`，填实际云环境 ID 和本人小程序 AppID。此文件仅供本地检查，当前骨架不会自动消费或上传它；后续客户端只配置公开云环境 ID。禁止在小程序和任何配置样例里填写密钥。

连接状态只使用 `unconfigured | checking | ready | failed`：缺配置时 `unconfigured`，真实请求进行中为 `checking`，成功验证相关服务后才为 `ready`，实际调用失败为 `failed`。本地测试或模拟响应不能把真实服务标为 `ready`。当前样例所有链路均为 `unconfigured`。

## 已实际执行的只读公共探测

- 时间：2026-11-04 06:46:11 UTC（北京时间 14:46:11）。本机 Node.js v24.19.0，公开 GET，15 秒超时，禁止重定向；无 Cookie、用户凭据、签名或绕过措施。
- B站检索请求：[search/type，关键词数据结构](https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&page=1)。HTTP 200，JSON `code: 0`、`message: OK`，响应 34633 字节。
- 返回的可核验样例：标题“《数据结构（C 语言描述）》也许是全站最良心最通俗易懂最好看的数据结构课”，作者“逊哥带你学计算机”，BV `BV1tNpbekEht`，[规范视频链接](https://www.bilibili.com/video/BV1tNpbekEht)。此处只证明此次检索返回了该记录，没有观看、核对课程内容或验证分集目录。
- 同一响应首项为 cheese 付费课程链接，BV 为空。后续适配器需要区分结果类型、去 HTML 高亮、按来源验证，不能将其误当成免费视频 BV。
- [公开 HTML 检索页](https://search.bilibili.com/all?keyword=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84)：HTTP 200，响应 324569 字节；未实现 HTML 解析，不能用此结果充当资源检索验收。
- 这是一次本机可用性探测，尚未实现检索适配器，也未证明 CloudBase 出口可用、持续可用或获平台长期 API 承诺。Task 5 需要重新运行真实资源测试；若限流/访问限制，停止并标记不可用，等待用户配置合规搜索服务，不以普通搜索链接替代真实资源。

## 未配置、未实测的链路

| 链路 | 状态与后续配置 |
| --- | --- |
| CloudBase / 微信身份 | `unconfigured`：实际小程序 AppID、同一账号关联云环境 ID、开发权限待用户配置；尚未访问控制台或部署。 |
| 腾讯云 OCR | `unconfigured`：需独立 OCR SecretId/SecretKey、地域、接口权限及用户确认的额度；模型 Key 不能代替 OCR 凭据。仅部署时配置到服务器安全位置；当前未检查或读取任何本机凭据。 |
| 用户模型 | `unconfigured`：HTTPS Base URL、模型名、用户输入 Key、服务器加密主密钥及调用上限待配置；加密保存由后续 Task 4 实现。没有真实请求或计费调用。 |
| 微信订阅消息 | `unconfigured`：实际模板 ID、模板真实字段名/类型/长度限制、页面路径、用户订阅授权及投递权限待配置。任务摘要、到期时间等语义字段必须映射到账号模板实际 `thingN`/`timeN` 等字段，不预填虚构字段。平台受理与用户已读必须分开记录。 |

提醒默认北京时间 08:00 和 20:00；只允许 08:00—23:00，单任务每日最多两次，完成或取消后停止。后续提醒模块落实这些规则，当前骨架不会发送提醒。

## 本地运行时、云运行时及导入

- 本地已执行 Node.js v24.19.0 / npm 11.17.0；使用 Node 内置测试框架，无第三方依赖。
- 云端配置样例选择 `Nodejs20.19`（[CloudBase 函数配置官方文档](https://docs.cloudbase.net/cli-v1/functions/configs)列为推荐运行时；[运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)列为支持版本，2026-11-04 查询）。本地 Node 24 通过不代表已在云端 Node 20 验证。`cloudbaserc.example.json` 仅提供后续 API 函数的部署配置骨架：环境 ID 为空且函数代码尚待 Task 2，不可直接部署。
- 微信开发者工具导入项目根目录，`project.config.json` 指向 `miniprogram/`、`cloudfunctions/`，采用官方项目配置字段（[微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/project.config.json)）。`touristappid` 仅供无真实账号的代码预览入口，云开发联调必须改为本人 AppID；不同开发工具版本对测试号支持可能不同。
- 已用本地测试解析项目配置和 app.json，并核查入口、全部注册页面配套文件及云函数根目录存在。没有启动微信开发者工具，没有宣称 IDE 编译、真机、云函数或订阅消息联调通过。

未开通任何服务、购买套餐、提交审核、部署云函数或修改云端状态。
