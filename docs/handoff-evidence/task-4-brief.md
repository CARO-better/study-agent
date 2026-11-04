# Global Constraints


- 新项目根目录：`D:/study-agent/`，不采用D盘现有项目的源码。
- 提醒仅限北京时间08:00—23:00，每个任务每天最多提醒两次。
- 默认08:00和20:00摘要，用户可修改；完成/取消任务不继续提醒。
- 文字＋截图识别结果均需检查确认才创建正式数据。
- 自动重排未来计划、保留固定安排、支持撤回；撤回不改变真实完成状态。
- 用户自定义模型服务，Key加密保存在云端，客户端不可回读明文。
- 真实OCR、搜索、模型和微信联调与模拟测试分开报告。
- 不自动开通付费服务、购买套餐或提交上线审核；相关配置待实现就绪后具体说明。


## Task 4：自定义模型、安全凭据与截图OCR

**Files:** `core/provider-settings.js`、`core/vault.js`、`adapters/safe-http.js`、`adapters/model.js`、`adapters/ocr.js`、`tests/providers.test.js`、`tests/imports.test.js`。

**Interfaces:** `callModel({owner,purpose,messages,schema},deps) -> Promise<{value,usage}>`；`extractScreenshot({owner,fileId},deps) -> Promise<{text,boxes,warnings}>`；`encryptSecret(value,masterKey)`/`decryptSecret(envelope,masterKey)`；`safeRequest(url,options) -> Promise<Response>`。

- [ ] 写失败测试：保存Key后返回仅掩码；认证加密被篡改时解密失败；私网、IPv6本地、DNS解析到私网、重定向跨域请求被拒绝；错误输出不回显Key；非JSON模型回复不创建任务；OCR失败仍保留草稿；低置信字段需确认。
- [ ] 运行 `node --test tests/providers.test.js tests/imports.test.js`，确认失败。
- [ ] 实现HTTPS目标校验、超时、大小/并发限制、AES-256-GCM、服务端加密主密钥和凭据删除；模型预设与自定义Chat Completions适配、连接测试和用量上限。
- [ ] 接入腾讯云OCR，保留文字框辅助课表解析，识别后的文字交给文本模型；图片归属校验、确认/放弃后的清理任务与24小时兜底清理。
- [ ] 再运行测试，要求通过；取得用户配置后另行执行真实模型/OCR联调并记录，不把桩测试当作真联通。

