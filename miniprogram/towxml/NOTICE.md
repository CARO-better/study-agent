# Towxml（vendored）

- 来源：https://github.com/sbfkcel/towxml （master，`6040d17`）
- 版本：3.3.1
- 许可证：MIT（见下方原文）
- 用途：把 AI 回复里的 Markdown 转成小程序 WXML 节点

## 本项目使用的构建配置

按 Towxml 3.0 的「按需构建」生成，只保留：

- `markdown: sub / sup / ins / mark / emoji / todo`
- `components: table / todogroup / img`
- 关闭：`echarts`（图表延后）、`latex`、`yuml`、`audio-player`
- 关闭：`highlight`（语言包是 ESM 语法，无法在 Node 下验证，AI 回复也很少有代码）

构建产物约 355KB / 48 个文件，直接复制到 `miniprogram/towxml`。
重新构建：改 `config.js` 后执行 `node build`，再把 `dist/` 覆盖到这里。

`decode.json` 里用的是绝对路径 `/towxml/...`，因此**这个目录必须放在 `miniprogram/towxml`**，改名或移动会导致组件找不到。

本项目在 `towxml.wxss` 末尾额外引入 `assistant-overrides.wxss`，只覆盖助手气泡内的字体、圆角内材质、链接与表格配色。原因是页面或外层组件样式无法稳定穿透 Towxml 的组件边界；覆盖文件不改变 Towxml 解析逻辑，也不改变上方 MIT 许可。

## MIT License

Copyright (c) Towxml contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
