# study-agent 接续交接：图片、聊天气泡与转场

交接日期：2026-11-07（北京时间）。唯一开发目录：**D:/study-agent**。

> **最新执行状态（2026-11-07 晚）**：第 5、6、7 节的三项必做已完成本地实现并通过 `177/177` Node 测试与开发工具浅/深色、弹层状态验证。图片在模拟器用生产选图路径处理了 386KB PNG 和 1.02MiB JPEG，分别得到 50,543 / 34,771 个 Base64 字符。真实模型识图、云部署、用户原始两张图片和手机真机仍未验收；选做共享元素未实施。证据与限制见 [release](releases/ui-followup-20261107.md)。下文“待排查/未执行”保留为接手当时的历史记录，不代表当前状态。

## 0. 本轮范围与最新指令

用户明确要求：**本轮不解决问题，只详细更新、完善交接文档**。本轮未改产品代码、未操作用户学习数据、未部署云端或上传小程序。下一位 agent 接到“继续”后，按本交接实施，不重新访谈已确定的风格。

用户最新反馈，保留原意：

1. 发一张 **1.1MB** 图片能识别，另一张 **270KB** 图片却提示需要压缩；要求解释、排查并改善这种体验。
2. AI 回复文本区域是纯方框，与用户消息的圆角气泡不一致。
3. 增加合理动效：按钮扩大成为详情页属于**选做**，难度大或明显增加包体可以搁置；弹窗必须有“从哪来、回哪去”的弹出与缩回逻辑，材质与整个界面的毛玻璃统一。

第 1、2 项和第 3 项的弹窗来去逻辑/材质一致性是待办；不能因为可选共享元素动画被搁置，就把必要的退场动画也搁置。

只在 D:/study-agent 操作，不随意修改 C 盘、全局 skill、hooks、provider 配置。若确需历史聊天，只看用户指定的置顶 **“study-agent2”**；不要沿用旧交接里另一个“study-agent”聊天的 ID 去读其他聊天。本交接已包含接续所需事实，通常无需再翻历史。

## 1. 接手顺序与权威材料

先读 AGENTS.md，再按下表阅读；不用把历史设计/计划未勾选项当作当前缺失功能。

| 文件 | 用途 |
| --- | --- |
| 本文 | 最新待办、事实边界与禁止回退点 |
| docs/ui-redesign-research-20261106.md | 已选择的设计方向、资源、具体删减策略 |
| docs/ui-redesign-plan-20261106.md | 已完成改版及审阅记录；不是新待办清单 |
| docs/releases/unreleased-ui-20261106.md | 玻璃 UI 范围和 166 项测试的历史证据 |
| docs/releases/image-request-20261107.md | 图片请求压缩补丁及其验证边界；**不能当作本次图片反馈已解决** |
| docs/FEATURES.md、CHANGELOG.md | 当前功能说明与最近提交范围 |
| docs/handoff-20261106-repair.md、docs/releases/v0.2.0.md | 既有 AI、同步、排程、B站能力；本轮不重写 |

HANDOFF.md 下半部分大量“纯本地/未接云/旧测试数”的内容过时，开头的新交接入口优先。当前基础 package 版本仍为 0.2.0，UI 记为未发布改版，不能宣称正式发布了 0.3.0。

## 2. Git、测试与运行现场

仓库：`https://github.com/CARO-better/study-agent.git`，分支 `codex/study-agent`。

| 提交 | 内容 |
| --- | --- |
| a0333d6f12d9075c679773388009b766f0963f42 | 0.2.0 修复基线，既有云能力与数据保护 |
| 2385175b8fcd37ee499c7ead254c7d42a9451606 | 极简玻璃 UI、常驻 AI 圆钮、共享助手控制器、编辑草稿冲突保护 |
| ceede4f515797edbc41b8c8ead8b661f160bd8be | 图片压缩和整体请求预算补丁，当前产品代码基线 |

本轮开始时工作区干净；`git rev-parse HEAD` 与 `git ls-remote origin refs/heads/codex/study-agent` 均为 ceede4f515797edbc41b8c8ead8b661f160bd8be。旧的“D 盘 HEAD 停在 af289de、索引混入已发布内容”已在本会话解决，不要再 reset 一遍。

历史最新验证（不是本轮重跑）：

- 图片补丁后 `npm test` **171 项通过、0 失败**；`npm run check-config` 返回 `ready=true, missing=[]`。
- UI 提交前 166 项通过，并完成独立只读审阅；发现的旧草稿覆盖问题已有失败→通过回归。
- UI 在开发工具检查了今日/课程/计划/设置、任务/课程/固定时间表单、消息、同步详情、助手、模型设置，覆盖浅深色和关闭动效；Lottie 实际查询 `ready/isLoaded` 为 true。
- 以上不等于手机软键盘、窄屏、长 Markdown 表格、降低透明度和所有真机流程通过。
- **图片补丁只有模拟平台 API 的 Node 测试，没有真实图片压缩/手机识别的端到端验证。** 用户现在的反馈证明仍有待排查情况。
- 本轮交接只做文档核对，不重新运行测试，不把历史计数写成本轮新证据。

此次交接为纯文档更新，按 AGENTS 小改动规则可本地提交、暂不推送；下一位接手先看 `git status -sb` / `git log -3`，产品代码基线与后续文档提交要分开。未来大改动必须按 AGENTS 更新文档、测试、按文件暂存、正常推送，并比较本地与远端完整哈希。不要强推。

若再次遇到本机 Git 引用丢失，根 HANDOFF.md 第 5 节保留了恢复办法；先核对 reflog，不要 hard reset/clean 或覆盖远端历史。本次两次产品提交的引用与推送均正常。

## 3. 必须延续的视觉与交互

- 极简、苹果原生应用的布局语言；删除重复品牌、口号、说明和每条记录上的常驻文字动作，不重新堆 SaaS 卡片。
- 左上 AI 圆形玻璃按钮常驻；展开的是当前页面上的助手浮层。底部四入口：今日、课程、计划、设置，右侧加号按当前页分发。
- 今日紧凑清单，任务正文编辑、左侧圈切换完成、更多菜单收纳资源和删除；设置为分组列表。
- 设备系统字体，中文 PingFang SC；浅色 #F2F2F7 / #1C1C1E，深色 #000000 / #F5F5F7；蓝色 #0069D9 / #68AFFF。沿用 app.wxss 的变量，避免新增一套不相干主题。
- 单列、通常 20px 边距，窄屏 16px；统一间距尺度与光学对齐，常用触控区域约 44px。图标带无障碍名称，不用 emoji 或混杂描边。
- 玻璃主要用于浮动控件、导航、弹层；内容层保持可读，不能用通透牺牲文字对比。不能把“一切玻璃”实现为每一层都重复重度模糊。
- 外观 system/light/dark 和动效开关必须保留。动效关闭时跳过移动/形变，功能状态仍清楚；当前显示偏好已还原到跟随系统、动效开启的默认状态，测试时若改动须还原。
- 正常态文字继续短；表单标签、同步冲突、覆盖/删除后果等会影响决定的说明保留。

## 4. 代码地图与不可回退的保护

| 路径 | 职责 |
| --- | --- |
| miniprogram/pages/today/index.{js,wxml,wxss,json} | 四个主分区、AI 入口/开关、菜单、编辑器、同步/资源/消息弹层 |
| miniprogram/lib/assistant.js | **共享 AI 控制器工厂**：图片选择、输入、模型请求、工具确认、生命周期 |
| miniprogram/components/assistant-panel/index.* | 浮层宿主；attached 初始化控制器，detached 调 onUnload，dismiss 通知主页面 |
| miniprogram/templates/assistant.wxml | 浮层和兼容页面共用的消息/输入/模型设置结构 |
| miniprogram/styles/assistant.wxss | 共用消息、富文本、输入、模型弹层样式 |
| miniprogram/pages/ai/index.* | 保留的兼容独立路由；JS 只有共享工厂包装，**不要只改这里而漏掉实际浮层** |
| miniprogram/lib/image-request.js | 图片压缩、MIME 和 UTF-8 整体请求预算 |
| miniprogram/lib/ai.js | 内容块、上下文裁剪、Agent 循环、云端/本地请求边界 |
| miniprogram/lib/cloud.js | callFunction 包装、错误映射 |
| miniprogram/lib/appearance.js、lib/shell.js | 独立偏好、系统主题订阅、导航/安全区几何 |
| miniprogram/components/study-motion、assets/study-motion.js、vendor/lottie | 本地动画及静态/异常降级，不加载外部动画资源 |

必须保留：

1. 学习数据 `study_trial_v1` 和现有云快照/API 结构；显示偏好 `study_appearance_v1` 独立存放，不能改学习字段来做 UI。
2. AI 新增课程/任务先确认，删除二次确认；关闭后延迟工具不能继续新增写入。`disposed` 与异步响应保护不能为动效方便而删掉。
3. 主页面允许 AI 在未保存编辑器之上展开，关闭后保留草稿。`saveEditor` 会重读最新存储并比较 `editorSource` / `editorCourseIds`；记录被更新/删除或课程选项变化时拒绝旧草稿覆盖。不要恢复成直接覆盖或让旧草稿复活已删记录。
4. 已发送的云端排程请求仍可能完成，这是既有行为；“关闭即阻断后续工具”不等于撤销已经发送的云操作。
5. 同步异常仍要可见、可处理；不要为了截图改成假成功，不清缓存、不插入示例、不覆盖真实数据。
6. 用户已确认另一端删除任务造成的较新云快照是预期修改，要求**保持当前云端数据**。不要依据旧截图的任务数量回滚；覆盖前副本已经由原同步流程保留。

相关回归：tests/appearance.test.js、assistant-panel.test.js、ui-shell.test.js、editor-conflict.test.js、image-request.test.js，以及原有 page-cloud / ai / sync / towxml 测试。

## 5. 待办一：1.1MB 可读、270KB 却提示压缩

### 已知事实与不足

- 用户反馈的是**原文件大小**，不是压缩结果或请求体大小。两张原图的格式、像素尺寸、内容复杂度、手机平台和会话长度尚未取得对照证据。
- 上一次错误截图明确是 `cloud.callFunction:fail Error: data exceed max size`，不能将它解释为模型不支持图片。
- 错误截图附件是聊天界面截图，不等于本次 1.1MB 与 270KB 两张原始测试图；不要拿截图文件大小当原始输入证据。
- 当前 `image-request.prepare`：20MiB 前置上限；小于等于 45,000 字节尝试保留原图；其余先 getImageInfo，再对原图依次压缩，宽度上限 1440/1080/800/640、quality 80/65/50/40，宽度不超过原图；每轮读 Base64，字符数 <=64,000 才接受。
- MIME 按 Base64 头识别 JPEG/PNG，不靠临时文件扩展名。超过上述压缩预算后才弹“请裁剪”提示。
- `check` 对整个 `{action:'ai.chat',payload:{messages,tools}}` JSON 测 UTF-8 字节，预算 90,000 字节；发送前和实际云调用前各检查一次。超限前不清输入/附件。
- **64,000 字符和 90,000 字节是上一位 agent 选取的保守兼容预算，不是已验证的微信跨平台官方硬上限。** 不能把它们固化为用户需求，更不能只改大数字就声称修好。
- Base64 通常比二进制约大 1/3；64,000 个 Base64 字符对应约 48KB 二进制。即使 270KB 原图也远高于此预算，是否能通过取决于压缩结果。

### 下一步排查（本轮没有执行）

1. 先区分提示发生在选图 `prepare`、点击发送前 `check`、工具循环后续 `requestModel`，还是原生 callFunction。不要统称“网络问题”。
2. 在本机/调试工具记录**非内容元数据**：平台/基础库、输入格式/宽高/字节数、每轮压缩参数与实际输出尺寸/字节数/Base64 长度、最终完整 JSON 字节数、失败阶段。不要输出 Base64、Key、消息全文或截图内容。
3. 对照 JPEG 照片与 PNG 截图、同像素不同格式、宽图/长图/竖图，以及空会话和已有会话。核实目标平台上 quality 对该格式是否实际生效、compressedWidth 是否按预期缩放、返回临时文件是否真的变化。
4. 重点检查“只按宽度”对窄长截图的作用；检查不同图片的像素数量/编码特征与原文件大小是否相反。**PNG、图像复杂度、平台压缩差异、窄长图、上下文开销均只是待核实的解释，不是本轮确诊结论。**
5. 现有 mock 测试只是伪造 compressImage 的返回值，不能证明真实压缩效果。补真实样本验证，必要时再向用户索取那两张原图；不要把附带的错误界面截图冒充原图。
6. 再决定是改善压缩/格式转换/尺寸策略，还是采用经过验证的文件上传或大数据传输通道。若涉及后端，必须核对所有者归属、输入校验、临时文件清理、成本与部署边界；不要把任意远程 URL 放开成服务器抓取入口，不把 Key 放前端，也不要未经核实直接套 CDN API。

### 验收

- 对照这两类图片，明确展示它们为什么通过/失败，不能只说“较小文件应该成功”。
- 识别路径不能以压到无法读字为代价；超限提示应准确指出需要处理什么，保留附件与输入，不丢掉已输入内容。
- 文字消息、截图内容块、仅保留最新一张图的历史裁剪、模型工具回执仍正常；避免整段历史重复携带多张原图。
- 分开记录本地测试、实际压缩、开发工具请求、真机识别；旧 171 项通过不替代此项验收。

## 6. 待办二：AI 方框与用户圆角气泡不一致

### 当前代码证据

- 共用模板中，`assistant && item.nodes` 进入 `.rich > towxml`；其他文本进入 `.bubble`。
- 样式只给 `.user .bubble` 明确设置 padding、背景和 `22px 22px 6px 22px` 圆角；`.rich` 只有宽度/溢出等规则，没有同一气泡外壳。
- Towxml 默认 light 主题有白底、dark 有黑底；其组件 `styleIsolation:'shared'`。现有 `.rich .h2w` 等覆盖是否在真机的实际节点层级上生效还需检查。
- 因此存在明确的**渲染分支/外壳差异**；具体纯白方框由哪个节点背景产生，不能未经真机样式核对就只归咎于某个选择器。

### 修改方向与验收

- 给 AI 富文本和纯文本降级共用一致的消息容器，统一圆角、内边距、边缘和材质层级；保留左右对齐/色彩差异以区分角色，不要求所有气泡颜色相同。
- 不要为圆角把 Markdown 全改为纯文本。标题、列表、引用、链接、表格继续可读。
- 若使用 overflow:hidden 裁圆角，要验证不裁掉表格横向滚动、长链接、图片与列表；不能仅给外框圆角但保留内层不透明方形白底。
- 同时验证助手浮层和 pages/ai 兼容路由，浅色/深色、短消息/长消息/列表/表格、解析失败纯文本、系统错误消息、图片气泡。不要只截空白欢迎态就宣称消息气泡已统一。

## 7. 待办三：有来源的转场与玻璃弹窗

### 当前现场

- app.wxss：`.overlay` 的 veil-in 和 `.sheet` 的 sheet-in 主要是通用淡入/上移。
- assistant-panel/index.wxss：panel-in 从 translateY(16px) scale(.98) 到稳定态；**没有从左上 AI 圆钮展开的几何联系**。
- `closeAssistant` 直接 `showAssistant:false`，宿主通过 wx:if 卸载组件；其他 close 方法也直接清布尔值，**没有可见的退场阶段**。
- 通用 `.glass` 已有 blur/saturate、边缘和高光；模型嵌套弹窗、表单、消息/资源与助手各自的层级/遮罩仍需统一审阅，不能仅因为都有 glass 类就认定一致。

### 必做

1. 为每类弹层指定来源和回归目标：AI↔左上圆钮；模型设置↔助手设置按钮；任务/课程编辑↔点击的行或新增按钮；消息/同步/资源↔各自入口。按实际入口处理，不用所有窗口同一方向飞入。
2. 设计 opening/open/closing/closed 等必要状态；退场完成后才卸载节点，关闭中防重复点击/多次 dismiss。关闭后落回原页面、滚动位置/未保存草稿，避免一闪回首页。
3. 延迟卸载不能引入危险窗口：**用户开始关闭后就应阻断未确认的后续 AI 工具**，不能等动画结束后 detached 才阻断。同步、主题取消订阅、Canvas 销毁和旧草稿冲突保护必须仍正确。
4. 保持统一的圆角、玻璃浓度、遮罩、阴影、边缘、速度和缓动；嵌套弹层层级明确，不叠出多层浑浊模糊。
5. 遵守 safe-area 与微信胶囊，禁止写死某一刘海高度。重开、快速开关、切后台、旋转/尺寸变化、键盘弹出、关闭动效都要有可用结果。
6. 关闭动效时立即或用必要的极短非空间反馈完成，不强迫形变、漂移或循环动画。

### 选做

按钮扩大成详情页/共享元素形变可以作为增强。优先用小程序可用的原生动画/WXSS 实现；若复杂、跨端不稳或显著增加体积，明确记录搁置理由。不要为了模仿折射引入大体积 WebGL/Shader 框架。即便搁置，以上必做仍要完成。

## 8. 资源、开发工具与常见陷阱

已下载并运用的资源都在 D 盘：

- `miniprogram/assets/icons/`：Lucide 按需 SVG、LICENSE、NOTICE；固定来源提交 `53fab88ff9d1b48f4704b5b5b560d6b4d560bf4c`，只改变描边颜色。继续用同一套，不恢复早期 Pillow 手绘图标。
- `output/ui-research/`：Apple materials/layout/tab-bars、WeUI navigation-bar 源码、Impeccable distill/clarify/polish 参考及 manifest。它们是参考资料，不是可随意执行的安装脚本。
- `docs/ui-redesign-research-20261106.md` 保留全部官方链接；Apple 官方 UI Kit / SF Symbols 作为视觉标尺，不能把 SwiftUI API 当作小程序 API。
- 未全局安装 Impeccable、未启用 hooks/live 引擎，未改变 C 盘配置。不要为了“使用 skill”擅自全局安装。

开发工具 CLI：`D:/微信web开发者工具/wechatide.cmd`；官方 skill：`D:/微信web开发者工具/resources/app.asar.unpacked/wechatide-skill/SKILL.md`。调用形如 `& 'D:/微信web开发者工具/wechatide.cmd' -c Codex <tool> --project 'D:/study-agent' ...`，没有 `-t`。按新会话的权限和 skill 门禁检查，不沿用旧 danger-full-access 假设，不改安全设置来绕过 token/审批。

注意：

- 新组件曾在模拟器错误拿到首页模板（磁盘代码正确、实例控制器正常，实际 shadow-root 却是今日页面）。关闭并重开**项目窗口**后恢复，未清存储。不要遇到类似现象就继续改布局；先检查运行实例模板是不是正确版本。
- 编译摘要不是整包验收；有时不同 file-path 摘要相同，不能单凭 success=true 判定真实渲染。
- 重开窗口/重新编译后自动化上下文可能短暂失效，勿立刻连续调用或盲目加长超时；先确定目标页面就绪。
- `output/ui-build/ide.py` 是本地辅助，参数文件已改为每次 UUID 独立文件；**不要并发操作同一模拟器**。`callMethod` 用 args-file，旧 `--args` 可能被报 deprecated。
- 在 automation_evaluate 中直接传 selector-query 回调曾出现“object could not be cloned”；使用工具支持的元素操作，不把桥接异常当作产品 bug。深层选择器返回对象可能不符合预期，先确认实际匹配节点再信任尺寸/样式。
- 避免 CUA 抢用户桌面；之前用户两次通过 Esc 停止桌面控制。能用专用 CLI 就优先 CLI；收到 Esc 停止后遵守停止要求。
- 截图在 `output/ui-build/`：glass-delivery-final、glass-delivery-today-light/dark、glass-delivery-ai-light、glass-delivery-ai-motion，以及 glass-model-dark、glass-task-light 等。它们主要是旧版/空态证据，**不能证明最新三个问题已通过**。
- output/ 已被 .gitignore 忽略，内有旧备份和一次性脚本。不要整份重跑 apply_ui.py/finish_ui.py/implement_glass.py，也不要 git add .。

## 9. 下一轮执行与交付

优先级：图片可靠性 → AI 消息外壳 → 弹窗来去逻辑/玻璃一致性 → 选做共享元素增强。可以按工作量拆步，但不要只写方案而不交付用户可试用结果。

先确认真实症状、写有意义的回归，再最小修改；避免为低影响样式写实现镜像测试。复杂 UI 以真实截图、交互和真机反馈验收，不把 mock 压缩、AST 测试或编译摘要混称真机通过。

收口按 AGENTS：更新 CHANGELOG 未发布、FEATURES、对应 release 说明，运行 npm test / check-config；按文件审阅暂存。大改动推送 origin/codex/study-agent，核对本地/远端完整哈希。小文档/单点微调本地提交即可，不重复推小提交。不要自动部署云端、上传体验版或正式发布；需要涉及新的部署动作时先把可审阅改动准备好。

最终汇报分别说明代码、Node 测试、开发工具渲染、真实图片处理、真机、云部署、小程序发布。未完成项照实保留，不把本交接的排查建议写成已实现。

## 10. Suggested skills / 建议技能

- **frontend-design**：用户显式调用过，`C:/Users/luojiahao/.agents/skills/frontend-design/SKILL.md`；继续极简苹果方向，不另起风格。
- **systematic-debugging / test-driven-development / verification-before-completion**：图片行为先取证，修复后匹配证据边界。
- **miniprogram-development / cloudbase / cloudbase-code-review**：本机 CloudBase skill 目录；涉及图片传输或云端动作时维护平台与安全边界，沿用现有授权而非重复确认已批准改版。
- **ui-design**：材质、消息层级、动效方案审阅；已确定字体/配色优先，不能被通用技能禁用系统字体的默认意见推翻。
- **wechatide-skill**：根入口后按 compiler / automator / debugger 场景读对应文件；按实际工具帮助使用参数。
- **handoff**：本轮用于整理接续；用户只在 D 盘操作的要求优先于其默认写 OS 临时目录的建议。

所有技能按会话可用目录读取即可；非必要不访问其他项目、旧 C 盘 worktree 或其他聊天，不安装全局依赖。
