# 极简玻璃界面：调研与改版方向

日期：2026-11-06（北京时间）。适用目录：D:/study-agent。

状态：资源筛选与设计方案；不代表新版界面已经实现、编译或发布。

## 用户本轮要求

- 删除不必要的内容，尤其文字；可辨认的常用操作使用极简图标。
- AI 从底部导航移至左上角常驻圆形浮层。
- 整体使用苹果玻璃材质语言，视觉对齐；布局和排版参考苹果原生应用。
- 先调研成熟方案、优质资源与相关 skill。

## 推荐的成熟组合

以 Apple「提醒事项」的任务列表为信息结构参考，以 HIG/官方 UI Kit 为尺寸、层级与材质参考；微信官方 WeUI 负责平台行为参照；Lucide 负责跨平台一致图标；Impeccable 负责删减与细节审阅。

### Apple 官方

| 资源 | 已核对的价值 | 本项目使用方式 |
| --- | --- | --- |
| [Apple Design Resources](https://developer.apple.com/design/resources/) | 官方 Figma/Sketch UI Kit、图标与设计资源 | 参考实际控件比例、圆角、列表与工具栏布局；不自行臆造一套“苹果风” |
| [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Liquid Glass 是导航、操作的独立浮动层；内容层宜保持清晰；避免过量堆叠玻璃 | 顶部 AI 圆钮、浮动底栏、操作工具条、弹层采用玻璃；任务正文保持稳定对比 |
| [HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 统一关系、留白与渐进披露，降低初始可见信息量 | 一组主标题、一条主内容流、一个当前主操作；次级动作放菜单/详情 |
| [HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 顶层目的地应稳定，导航和当前内容动作分离 | 底部保留今日、课程、计划、设置；AI 改为全局独立入口 |
| [HIG SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) 与 [SF Symbols](https://developer.apple.com/sf-symbols/) | 参考图标语义、光学尺寸、字重与基线关系 | 作为视觉标尺；小程序资源统一选自适合跨平台的同一图标集 |
| [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 字号、字重与内容层级 | 沿用设备系统字体；控制字号层级，不重复展示品牌、标题、口号 |
| [WWDC25: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) | 材质动态、适应背景与分层原则的官方演示 | 校准模糊、透明度、边缘高光、形变的克制程度 |
| [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) | 原生实现思路、导航层与内容层的关系 | 参考行为和材料层次；不能将 SwiftUI API 当作微信小程序 API |
| [提醒事项：管理列表](https://support.apple.com/en-gb/guide/iphone/iph2c6cf708e/ios) | 系统应用中列表、少量元信息和更多菜单的成熟模式 | 今日改为紧凑清单，课程改为连续列表，减少每条记录的外壳与按钮 |

### 微信平台与图标

| 资源 | 已核对的价值 | 本项目使用方式 |
| --- | --- | --- |
| [WeUI 小程序组件库](https://github.com/wechat-miniprogram/weui-miniprogram) | 微信官方组件与小程序交互惯例，包含深色适配和半屏弹窗等实现 | 参考导航、表单、弹层、长列表与交互；不整包迁入无关组件 |
| [WeUI navigation-bar 源码](https://github.com/wechat-miniprogram/weui-miniprogram/blob/master/src/components/navigation-bar/navigation-bar.ts) | 以胶囊边界和状态栏计算布局 | AI 圆钮对齐导航区，避开状态栏与微信右上角胶囊；不能写死刘海高度 |
| [Lucide](https://github.com/lucide-icons/lucide) / [图标设计规范](https://lucide.dev/contribute/icons/design-principles) | 同一 24×24 网格、统一描边、圆端点与留白 | 新增、关闭、更多、消息、设置、附件等使用同一套图标，保留无障碍名称 |
| [微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/) | 官方设计入口 | 本轮网页抓取不可用；不把未读取的页面当作已核对证据，具体兼容性以官方组件源码和开发工具实测补充 |

### Skill 资源

| 资源 | 适合做什么 | 边界 |
| --- | --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable) | 将“做减法、文字、排版、细节”拆成可执行审阅维度 | 本轮为调研，未执行远端安装脚本或自动启用 hooks |
| [distill](https://github.com/pbakaus/impeccable/blob/main/skill/reference/distill.md) | 删除重复标题、口号、冗余卡片、并列次级操作；逐步展示复杂选项 | 最贴合本次要求；保留必要功能入口与恢复路径 |
| [clarify](https://github.com/pbakaus/impeccable/blob/main/skill/reference/clarify.md) | 每个状态只说一次；解释只在影响决定时出现 | 不能为了文字少，隐藏冲突、错误或覆盖数据的后果 |
| [polish](https://github.com/pbakaus/impeccable/blob/main/skill/reference/polish.md) | 统一间距、光学对齐、字重、所有状态的细节 | 最终必须看实际小程序渲染，而不是只凭 CSS/规则扫描 |
| [OpenAI SwiftUI Liquid Glass skill](https://github.com/openai/plugins/blob/main/plugins/build-ios-apps/skills/swiftui-liquid-glass/SKILL.md) | 核对玻璃层次、交互边界、容器与兼容降级 | 针对 SwiftUI，不作为原生微信小程序的直接实现依赖 |
| 本机 frontend-design / ui-design | 已读取的设计与实现审阅能力 | 使用用户指定的苹果系统字体和配色；不另起网页模板风格 |

## 设计规格

- 场景：个人学习工具，属于操作界面。优先快速识别、低干扰和稳定布局。
- 视觉：原生列表 + 浮动玻璃导航；通透但不过量嵌套；内容层材质比操作层更实。
- 颜色：浅色基底 #F2F2F7、正文 #1C1C1E；深色基底 #000000、正文 #F5F5F7；蓝色仅用于当前选中和主要动作。玻璃透明度按背景和可读性决定。
- 字体：设备系统字体，中文优先 PingFang SC；大标题、正文、次要信息三级为主。
- 布局：单列，统一左右 20pt（窄屏 16pt）；4/8/12/16/24/32pt 间距尺度；图标按同一视觉尺寸；常用触控区域约 44pt。
- 顶部：左上 AI 圆形浮钮常驻；右上微信胶囊安全区保留。圆钮打开助手，关闭后回到当前工作位置。
- 底部：四目的地的悬浮玻璃胶囊，保持位置稳定；AI 不再占用一个 tab。

## 对当前界面的具体删减

| 当前内容 | 新方向 |
| --- | --- |
| 品牌小字 + 页面大标题 + 日期 + 口号 + 数量 + 待办标题 | 单一页面标题，必要时加日期或待办数；删除口号与重复标题 |
| 整块同步说明、时间戳、常驻同步按钮 | 紧凑状态入口；失败/冲突有可见提示，详情和恢复操作按需展开 |
| 每条任务三行元信息及“编辑/资源/删除” | 任务名 + 一行必要元信息；完成圆圈和更多入口；次级动作收进菜单 |
| 课程大卡片与并列文字动作 | 紧凑分组列表，编辑/删除由更多菜单或详情进入 |
| 计划页多段空态和说明 | 可用时间、固定安排、排期三组；空态一行，主操作单一突出 |
| 设置页多段架构、同步、Key、快照说明 | 分组设置行；技术解释移到帮助/详情，恢复等风险动作保留必要提示 |
| AI 欢迎口号、长能力介绍、三张大建议卡 | 紧凑欢迎/输入态；附件与发送用图标；模型设置由图标进入 |
| 关闭/取消/新增等高频文字动作 | 语义明确时用统一图标；表单字段名、危险确认、未知状态保留最短必要文字 |

## 实现与验收边界

- 保留现有云 API、学习数据键、快照结构、同步协议、AI 确认与恢复保护。
- 小程序不能调用 Apple 原生 SwiftUI 材质 API。采用可验证的 WXSS 视觉实现；模糊不可用时提供同色半透明/实色降级。
- 不引入 WebGL 折射库或大段网页组件来追求截图效果；逐层核对滚动、输入、键盘与设备性能。
- 原有真实学习数据不清除，不为截图插入示例，不把失败状态改为成功。
- 对新增的菜单分发、导航与助手生命周期做必要回归；普通样式不写镜像测试。
- 浅色/深色、关闭动效、长标题、表单/菜单/弹层、AI、窄屏均需验证；模拟器、真机、云部署、正式发布分别记录。

## 本轮研究结论

推荐按上述组合实现。外观跟随系统、动效开关与上一轮修复继续保留。研究阶段的方案已进入实现；当前结果以 releases/unreleased-ui-20261106.md 为准。
