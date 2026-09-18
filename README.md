# Infinite Canvas Node Pack

一个面向 Infinite Canvas 的多节点插件仓库。插件采用模块化结构，每个节点独立放在 `src/nodes/`，最终统一构建为一个可安装的 ESM JavaScript 文件。

## 当前节点

- 文本输入：输入文本并向下游输出 text resource。
- 合并文本：自动汇总所有上游文本。
- AI 文本处理：复用 Infinite Canvas 已配置的文本模型处理上游内容。

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
    text-input.tsx
    text-merge.tsx
    ai-text.tsx
sdk/
dist/
build.mjs
package.json
tsconfig.json
```

> 注意：Infinite Canvas 节点插件会直接在画布页面环境中执行，只应安装可信来源。
