import { definePlugin } from "@infinite-canvas/plugin-sdk";

import { runningHubNode } from "./nodes/runninghub";

export default definePlugin({
  id: "infinite-canvas-node-pack",
  name: "Infinite Canvas 节点包",
  version: "0.3.5",
  description: "可持续扩展的多节点插件包。当前首个正式节点为 RunningHub AI 应用工作流节点。",
  nodes: [
    runningHubNode
  ]
});
