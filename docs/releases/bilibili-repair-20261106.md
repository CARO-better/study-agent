# B站检索修复验证记录

日期：2026-11-06（北京时间）。项目：`D:\study-agent`。

## 问题与修复

首页“复习资源”报 B站暂时无法检索。真实微信身份下的云端诊断显示“获取签名：域名解析被安全检查拦截”。根因是 `net.BlockList` 会将 IPv4 与映射 IPv6 比较，同一列表中的 `::ffff:0:0/96` 因而拦截了全部普通公网 IPv4。

修复将 IPv4/IPv6 禁止网段隔离；所有原禁止网段保持不变，映射 IPv6、私网、metadata、保留地址、无效地址及混合安全/不安全 DNS 结果仍拒绝。DNS pinning 同时兼容 Node 20 `all:true` 约定。B站适配器只返回固定阶段、固定原因或数字状态码，不暴露原始网络错误、响应体、Cookie、关键词。

## 验证证据

- 完整工作区 `npm test`：140 项通过，0 失败；`npm run check-config` 为 ready；`git diff --check` 通过。
- 从 `af289de` 基线只叠加本次独立修复后，另运行 `npm test`：106 项通过，0 失败；没有将前序 0.2.0 改动混入这份验证快照。
- 回归覆盖公网 IPv4/IPv6 放行、私网/保留/映射地址拒绝、混合 DNS 结果拒绝、两种 lookup 回调约定及错误脱敏。
- 已更新现有环境 `cloud1-d2gobmqen9fd1cba1` 的 `api`，最终部署 requestId：`35755f7d-19f8-428b-8634-3d97a4abc492`；未改环境变量、网络入口、权限或日志服务。
- 微信开发者工具真实身份调用 `resources.search` 成功返回 2 个视频，包含 `BV1ju6TYHEKU` 与 `BV1STun6hEHo`。
- 当前工作区首页实际 `recommend` 方法调用 `resources.recommendSnapshot`，返回 3 组、每组 4 个视频；notice 为“来源：哔哩哔哩实时检索；点击复制原视频链接”，`resourceBusy:false`，12 个链接均为规范 B站视频 URL。
- 开发工具页面元素查询确认 12 个 `.resource-card` 已生成；未验证手机端显示或剪贴板操作。

## 历史独立补丁与升级边界

后续用户明确要求推送当前完整版本，最终发布范围改为完整 0.2.0（含 AI、快照、排程和 B站修复）。下面的独立补丁与 Git 阻塞记录保留为历史验证过程，不是最终提交范围。

准备的独立补丁仅包含安全 HTTP/B站适配器修复、相关回归及对应文档。前序 0.2.0 的快照、AI、排程和页面接入等工作区改动保留并单独收口；140 项测试与上述页面证据不能作为独立补丁完整包含这些功能的声明。补丁内的功能说明仅更新 B站后端状态；当前工作区功能说明另反映页面实测。

Git 收尾尚未完成：目录与 `.git` 写权限分别获准后，`git add` 仍报 `Unable to create 'D:/study-agent/.git/index.lock': Permission denied`。未修改 ACL、未暂存、未提交或推送，HEAD 保持 `af289de`。可审阅独立补丁保存在 `C:\Users\luojiahao\Documents\Codex\2026-11-06\h\work\bilibili-repair-20261106\bilibili-repair.patch`；恢复 Git 写权限后再按仓库约定提交、推送并核对远端哈希。

线上后端已更新；现有工作区无需迁移或清缓存，重新点击“复习资源”即可。外部接口仍可能限流或风控，失败不生成猜测链接。本次未验证真实模型、截图识别、同步恢复/冲突、手机完整流程或正式上传。
