# Infinite Canvas Node Pack

一个面向 Infinite Canvas 的多节点插件仓库。插件采用模块化结构，每个节点独立放在 `src/nodes/`，最终统一构建为一个可安装的 ESM JavaScript 文件。

## 当前节点

### RunningHub

首个正式节点。输入 RunningHub API Key 和 AI 应用 WebAppId（也支持应用链接）后，可以读取应用开放参数并把它变成一个可直接运行的动态工作流节点。

当前能力：

- RunningHub 国内站 / 国际站 API Key 独立保存并共享复用；
- 拉取 AI 应用开放参数，自动识别文本、数字、布尔、下拉、图片、视频、音频字段；
- 保存常用应用到插件级 RunningHub 应用库；
- 应用库支持搜索、分类、收藏、改名、刷新、删除；
- 新建 RunningHub 节点可直接选择已保存应用，不需要再次输入 WebAppId；
- 应用 Schema 刷新时不会静默破坏已有画布节点，需要手动确认更新当前节点；
- 字段可绑定画布中的兼容节点，选择绑定时自动建立画布连接；
- 媒体参数支持绑定上游媒体或选择本地文件，运行时自动上传到 RunningHub；
- 提交 AI 应用任务并轮询结果，可停止本地查询或稍后继续查询；
- 成功后自动把图片 / 视频 / 音频 / 文本结果生成标准 Infinite Canvas 下游节点。

## 安装

在 Infinite Canvas 的「节点插件 → 第三方插件」中填写下面任一地址：

### GitHub Raw

```text
https://raw.githubusercontent.com/kjx372124896/infinite-canvas/infinite-canvas-node-pack/dist/infinite-canvas-node-pack.js
```

### jsDelivr（推荐）

```text
https://cdn.jsdelivr.net/gh/kjx372124896/infinite-canvas@infinite-canvas-node-pack/dist/infinite-canvas-node-pack.js
```

## 开发

```bash
npm install
npm run typecheck
npm run build
```

构建产物：

```text
dist/infinite-canvas-node-pack.js
```

## 添加新节点

1. 在 `src/nodes/` 新建一个 TSX 文件。
2. 导出一个 `CanvasNodeDefinition`。
3. 在 `src/index.tsx` 导入并加入 `nodes` 数组。
4. 运行 `npm run typecheck && npm run build`。
5. 提交并推送；用户在 Infinite Canvas 中点击「从来源更新」即可获得新版本。

## 目录

```text
src/
  index.tsx
  nodes/
    runninghub.tsx
  runninghub.ts
sdk/
dist/
build.mjs
package.json
tsconfig.json
```

> 注意：Infinite Canvas 节点插件会直接在画布页面环境中执行，只应安装可信来源。
