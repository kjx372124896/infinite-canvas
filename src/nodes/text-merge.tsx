import { useEffect } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";

function getText(node: ReturnType<CanvasNodeContentProps["ctx"]["getUpstream"]>[number]) {
  return typeof node.metadata?.content === "string" ? node.metadata.content.trim() : "";
}

function TextMergeContent({ ctx }: CanvasNodeContentProps) {
  const upstream = ctx.getUpstream();
  const merged = upstream
    .map((node, index) => {
      const text = getText(node);
      return text ? `【输入${index + 1} · ${node.title}】\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const stored = typeof ctx.node.metadata?.content === "string" ? ctx.node.metadata.content : "";

  useEffect(() => {
    if (stored !== merged) {
      ctx.updateMetadata({ content: merged, status: merged ? "success" : "idle" });
    }
  }, [merged, stored]);

  return (
    <div
      onWheel={(event) => event.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        padding: 12,
        overflow: "auto",
        color: ctx.theme.node.text,
        fontSize: 13,
        lineHeight: 1.55,
        whiteSpace: "pre-wrap"
      }}
    >
      {merged || <span style={{ color: ctx.theme.node.placeholder }}>连接一个或多个上游文本节点后自动合并。</span>}
    </div>
  );
}

export const textMergeNode: CanvasNodeDefinition = {
  type: "node-pack:text-merge",
  title: "合并文本",
  icon: "🧩",
  description: "自动合并所有上游文本，适合汇总上下文或组装提示词。",
  defaultSize: { width: 360, height: 240 },
  defaultMetadata: { content: "", status: "idle" },
  minimapColor: "#0ea5e9",
  resource: (node) => {
    const text = typeof node.metadata?.content === "string" ? node.metadata.content : "";
    return text ? { kind: "text", text } : null;
  },
  Content: TextMergeContent
};
