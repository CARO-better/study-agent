# 2026-11-07 统一居中扩散弹层（Surface Host）

状态：未发布界面收口。包版本仍为 0.2.0，不宣称正式发布 0.3.0。

## 结论

本轮把应用自有的二级界面从各自底部 sheet/overlay 收敛为统一的居中玻璃 Surface Host。点击的图标、行或菜单项会先扩散成屏幕中央的大卡片，关闭时再缩回同一来源；消息气泡、Markdown 和图片可靠性改动保持不变。

## 检索与取舍

- TDesign、WeUI、mp-components 等组件库只有普通居中弹层，没有共享元素形变。
- `wx-transition` 只提供通用进出场，不解决来源几何。
- 微信官方 `awesome-skyline/card_transition` 有共享元素，但依赖 Skyline/Worklet，不适合当前 WebView 架构。
- `page-container` 可以接管系统返回，但一页只能有一个容器，系统返回会直接关闭整个假页，无法逐层关闭“AI → 模型设置”或确认框。本轮因此不引入它，保留自绘 Surface Host 的层级控制；系统返回键仍按小程序默认行为。

## 实现结构

- `miniprogram/lib/morph.js`：来源/目标矩形 → 位移、缩放、圆角的纯几何计算；测量失败回退到居中淡入，不会生成无限缩放。
- `miniprogram/components/surface-panel`：统一居中卡片壳，负责来源测量、玻璃卡片、遮罩、内容淡入淡出、键盘高度收拢、减少动效、退场后卸载。
- `miniprogram/lib/surface-bus.js` + `miniprogram/components/app-dialog`：菜单、确认、提示、可编辑输入的 Promise API 和居中弹层；宿主销毁/重置时所有排队请求都会以取消结束，不会悬挂。
- `assistant-panel` 与 `pages/ai`：AI 卡片使用同一套圆钮几何，模型设置是 AI 卡片内部居中子视图。

## 来源映射

| 触发 | 目标 Surface |
| --- | --- |
| 左上圆钮 / AI 设置入口 | AI 居中大卡片 / 模型设置子视图 |
| 云朵、未同步横幅、设置-同步 | 同步卡片 |
| 铃铛 | 消息卡片 |
| 任务行、任务更多-编辑、快速添加 | 任务编辑卡片 |
| 课程行、课程更多-编辑、快速添加 | 课程编辑卡片 |
| 任务更多-复习资源 | 复习资源卡片 |
| 计划添加、外观、更多设置 | 自定义操作菜单 |
| 删除、恢复、同步确认、AI 创建/删除确认 | 自定义确认/提示弹窗 |

## 视觉与交互

- 卡片默认宽度约 92vw、最大 560px；长表单/消息/资源高度受屏幕限制并在内部滚动。
- 位移和缩放从来源矩形插值到卡片矩形；内容在扩散过程中淡入，关闭先淡出再缩回。
- 玻璃继续使用 `--glass`、`--veil`、圆角、边缘高光和阴影变量；没有新增动画库或第三方 UI 组件。
- 编辑输入使用 `adjust-position="{{false}}"`，由 Surface Host 的键盘高度收拢卡片，避免系统滚动和卡片位移互相打架。
- 关闭动效开关为 false 时不做空间形变，直接卸载。

## 验证证据

### 本地自动化

- `npm test`：188 项通过、0 失败。
- `npm run check-config`：`ready=true, missing=[]`。
- 新增/强化回归：来源矩形缩放、触摸点回退、失败测量不会产生爆炸缩放、弹窗队列顺序、宿主销毁/重置后 Promise 仍结束、`showCancel:false` 回退语义、菜单/计划/编辑状态映射。

### 开发工具

实际打开并检查：

- 云朵 → 同步居中卡片。
- 铃铛 → 消息居中卡片。
- 任务行 → 居中任务编辑卡片。
- AI 圆钮 → 居中 AI 大卡片；模型设置 → AI 内部居中子视图。
- 任务更多 → 自定义操作菜单；确认弹窗可取消并返回 Promise。
- 任务菜单选择“编辑”会打开同一居中编辑卡片。
- `pages/ai` 兼容路由会从 AI 圆钮读取真实矩形，进入同一形变。
- 浅色与深色均有截图；关闭时 `surfaceClosing`/`assistantClosing` 先保持节点，约动画时长后卸载。
- 最终编译无 WXML/WXSS/JS 错误，错误日志为空。

截图（本地 `output/ui-build/`，不纳入仓库）：

- `surface-today-light.png`
- `surface-sync-light.png`
- `surface-inbox-light.png`
- `surface-task-light-final.png`
- `surface-ai-light-final.png`
- `surface-model-light-final.png`
- `surface-menu-light.png`
- `surface-ai-page-light.png`

## 边界与未验证

- 系统日期/时间/课程选择器、相册、相机、分享、授权、微信图片预览、Toast/Loading 保持原生。
- 系统返回键仍退出页面，不会像 `page-container` 那样逐层关闭弹层；按钮关闭和遮罩关闭都有原路返回。
- 手机真机的 IME/键盘遮挡、长表格滚动、系统降低透明度、不同屏幕比例仍需真机验收。
- 未改学习数据、云快照、同步协议、AI 确认流程或编辑冲突保护。
- “按钮扩大为详情页”的共享元素详情页仍未做。
