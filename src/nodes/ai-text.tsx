import { useMemo, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";

function AiTextContent({ ctx }: CanvasNodeContentProps) {
  const models = ctx.ai.listModels("text");
  const savedModel = typeof ctx.node.metadata?.pluginModel === "string" ? ctx.node.metadata.pluginModel : "";
  const model = savedModel || ctx.ai.defaultModel("text") || models[0]?.value || "";
  const instruction = typeof ctx.node.metadata?.pluginInstruction === "string" ? ctx.node.metadata.pluginInstruction : "";
  const output = typeof ctx.node.metadata?.content === "string" ? ctx.node.metadata.content : "";
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const upstreamText = useMemo(
    () =>
      ctx
        .getUpstream()
        .map((node) => (typeof node.metadata?.content === "string" ? node.metadata.content.trim() : ""))
        .filter(Boolean)
        .join("\n\n"),
    [ctx.getConnections().length, ctx.getNodes().length]
  );

  const run = async () => {
    const userInstruction = instruction.trim();
    if (!userInstruction && !upstreamText) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    ctx.updateMetadata({ status: "loading", errorDetails: "" });

    const prompt = upstreamText
      ? `以下是上游提供的上下文：\n\n${upstreamText}\n\n请执行下面的任务：\n${userInstruction || "整理并输出上述内容。"}`
      : userInstruction;

    try {
      const result = await ctx.ai.generateText(prompt, {
        model: model || undefined,
        signal: controller.signal
      });
      ctx.updateMetadata({ content: result.text, status: "success", pluginModel: model });
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.updateMetadata({
          status: "error",
          errorDetails: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
    ctx.updateMetadata({ status: "idle" });
  };

  const controlStyle = {
    width: "100%",
    boxSizing: "border-box" as const,
    border: `1px solid ${ctx.theme.node.stroke}`,
    borderRadius: 8,
    background: ctx.theme.node.panel,
    color: ctx.theme.node.text
  };

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
      <select
        value={model}
        onChange={(event) => ctx.updateMetadata({ pluginModel: event.target.value })}
        style={{ ...controlStyle, height: 32, padding: "0 8px" }}
      >
        {models.length === 0 ? <option value="">使用宿主默认文本模型</option> : null}
        {models.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>

      <textarea
        value={instruction}
        placeholder={upstreamText ? "输入对上游内容的处理要求…" : "输入要让 AI 执行的任务…"}
        onChange={(event) => ctx.updateMetadata({ pluginInstruction: event.target.value })}
        style={{ ...controlStyle, minHeight: 76, resize: "vertical", padding: 8, outline: "none" }}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={running ? stop : run}
          style={{
            border: `1px solid ${ctx.theme.node.stroke}`,
            borderRadius: 8,
            padding: "5px 12px",
            cursor: "pointer",
            background: ctx.theme.toolbar.activeBg,
            color: ctx.theme.toolbar.activeText
          }}
        >
          {running ? "停止" : "生成"}
        </button>
        <span style={{ alignSelf: "center", fontSize: 11, color: ctx.theme.node.muted }}>
          上游文本：{ctx.getUpstream().length} 个
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          padding: 9,
          borderRadius: 8,
          background: ctx.theme.node.fill,
          fontSize: 13,
          lineHeight: 1.5
        }}
      >
        {output || <span style={{ color: ctx.theme.node.placeholder }}>AI 输出会显示在这里，并可继续连接下游节点。</span>}
      </div>
    </div>
  );
}

export const aiTextNode: CanvasNodeDefinition = {
  type: "node-pack:ai-text",
  title: "AI 文本处理",
  icon: "✨",
  description: "读取上游文本，调用 Infinite Canvas 已配置的文本模型处理并输出。",
  defaultSize: { width: 400, height: 420 },
  defaultMetadata: {
    content: "",
    pluginInstruction: "",
    pluginModel: "",
    status: "idle"
  },
  minimapColor: "#8b5cf6",
  resource: (node) => {
    const text = typeof node.metadata?.content === "string" ? node.metadata.content : "";
    return text ? { kind: "text", text } : null;
  },
  Content: AiTextContent
};
