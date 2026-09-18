import { definePlugin } from "@infinite-canvas/plugin-sdk";

import { aiTextNode } from "./nodes/ai-text";
import { textInputNode } from "./nodes/text-input";
import { textMergeNode } from "./nodes/text-merge";

export default definePlugin({
  id: "infinite-canvas-node-pack",
  name: "Infinite Canvas 节点包",
  version: "0.1.0",
  description: "可持续扩展的多节点插件包。首版包含文本输入、文本合并、AI 文本处理三个基础节点。",
  nodes: [
    textInputNode,
    textMergeNode,
    aiTextNode
  ]
});
