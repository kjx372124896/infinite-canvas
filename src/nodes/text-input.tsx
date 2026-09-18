import type { CanvasNodeContentProps, CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";

function TextInputContent({ ctx }: CanvasNodeContentProps) {
  const content = typeof ctx.node.metadata?.content === "string" ? ctx.node.metadata.content : "";

  return (
    <div
      data-canvas-no-zoom
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: ctx.theme.node.text
      }}
    >
      <div style={{ fontSize: 12, color: ctx.theme.node.muted }}>文本输入</div>
      <textarea
        value={content}
        placeholder="输入要传给下游节点的文本…"
        onChange={(event) => ctx.updateMetadata({ content: event.target.value, status: "success" })}
        style={{
          flex: 1,
          width: "100%",
          resize: "none",
          border: `1px solid ${ctx.theme.node.stroke}`,
          borderRadius: 10,
          outline: "none",
          padding: 10,
          boxSizing: "border-box",
          background: ctx.theme.node.panel,
          color: ctx.theme.node.text,
          fontSize: 13,
          lineHeight: 1.5
        }}
      />
    </div>
  );
}

export const textInputNode: CanvasNodeDefinition = {
  type: "node-pack:text-input",
  title: "文本输入",
  icon: "✍️",
  description: "输入文本，并作为文本资源传给下游节点。",
  defaultSize: { width: 320, height: 220 },
  defaultMetadata: { content: "", status: "idle" },
  minimapColor: "#64748b",
  resource: (node) => {
    const text = typeof node.metadata?.content === "string" ? node.metadata.content : "";
    return text ? { kind: "text", text } : null;
  },
  Content: TextInputContent
};
