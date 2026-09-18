import { useEffect, useMemo, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeData, CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";

import {
  blobFromCanvasNode,
  canvasNodeResourceKind,
  deleteRunningHubApp,
  fetchRunningHubApp,
  getRunningHubCredential,
  loadRunningHubApps,
  markRunningHubAppUsed,
  nodeResourceForRunningHub,
  outputKind,
  parseRunningHubReference,
  patchRunningHubApp,
  pollRunningHubTask,
  queryRunningHubTask,
  removeRunningHubCredential,
  RUNNINGHUB_BASE_URL,
  saveRunningHubCredential,
  startRunningHubTask,
  type RunningHubCategory,
  type RunningHubField,
  type RunningHubFieldKind,
  type RunningHubSavedApp,
  type RunningHubSite,
  type RunningHubTaskState,
  upsertRunningHubApp,
  uploadRunningHubBlob,
  validateRunningHubCredential,
} from "../runninghub";

type Values = Record<string, unknown>;
type Bindings = Record<string, string>;
type UploadNames = Record<string, string>;

const categoryLabel: Record<RunningHubCategory, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  motion: "动作",
  other: "其他",
};

function objectMetadata<T>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : fallback;
}

function stringMetadata(value: unknown) {
  return typeof value === "string" ? value : "";
}

function initialValues(app: RunningHubSavedApp) {
  return Object.fromEntries(app.fields.map((field) => [field.key, field.defaultValue]));
}

function compatibleKind(fieldKind: RunningHubFieldKind, node: CanvasNodeData) {
  const kind = canvasNodeResourceKind(node);
  if (fieldKind === "image" || fieldKind === "video" || fieldKind === "audio") return kind === fieldKind;
  return kind === "text";
}

function filenameForBlob(blob: Blob, field: RunningHubField, sourceName?: string) {
  if (sourceName && /\.[A-Za-z0-9]{2,6}$/.test(sourceName)) return sourceName;
  const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^A-Za-z0-9]/g, "") || (
    field.kind === "image" ? "png" : field.kind === "video" ? "mp4" : field.kind === "audio" ? "mp3" : "bin"
  );
  return `${field.fieldName || "input"}.${ext}`;
}

function Button({ children, onClick, disabled, danger = false, title, compact = false }: {
  children: any;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        border: "1px solid currentColor",
        borderRadius: 8,
        padding: compact ? "3px 7px" : "6px 10px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: "transparent",
        color: danger ? "#ef4444" : "inherit",
        fontSize: compact ? 10 : 11,
        lineHeight: 1.2,
      }}
    >
      {children}
    </button>
  );
}

function RunningHubContent({ ctx }: CanvasNodeContentProps) {
  const [apps, setApps] = useState<RunningHubSavedApp[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [view, setView] = useState<"main" | "add" | "library">("main");
  const [site, setSite] = useState<RunningHubSite>("cn");
  const [reference, setReference] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [hasCredential, setHasCredential] = useState<Record<RunningHubSite, boolean>>({ cn: false, global: false });
  const [credentialNote, setCredentialNote] = useState("");
  const [previewApp, setPreviewApp] = useState<RunningHubSavedApp | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState<"all" | RunningHubCategory>("all");
  const [pendingRefresh, setPendingRefresh] = useState<RunningHubSavedApp | null>(null);
  const [taskState, setTaskState] = useState<RunningHubTaskState | null>(null);
  const runControllerRef = useRef<AbortController | null>(null);

  const selectedApp = objectMetadata<RunningHubSavedApp | null>(ctx.node.metadata?.rhApp, null as RunningHubSavedApp | null);
  const values = objectMetadata<Values>(ctx.node.metadata?.rhValues, {});
  const bindings = objectMetadata<Bindings>(ctx.node.metadata?.rhBindings, {});
  const uploadNames = objectMetadata<UploadNames>(ctx.node.metadata?.rhUploadNames, {});
  const lastTaskId = stringMetadata(ctx.node.metadata?.rhTaskId);
  const lastStatus = stringMetadata(ctx.node.metadata?.rhTaskStatus);
  const upstream = ctx.getUpstream();
  const allNodes = ctx.getNodes();

  const refreshLibrary = async () => {
    const nextApps = await loadRunningHubApps(ctx.storage);
    setApps(nextApps);
    const [cnKey, globalKey] = await Promise.all([
      getRunningHubCredential(ctx.storage, "cn"),
      getRunningHubCredential(ctx.storage, "global"),
    ]);
    setHasCredential({ cn: Boolean(cnKey), global: Boolean(globalKey) });
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await refreshLibrary();
      } finally {
        if (live) setLoadingLibrary(false);
      }
    })();
    const off = ctx.on("runninghub:library-changed", () => void refreshLibrary());
    return () => {
      live = false;
      off();
      runControllerRef.current?.abort();
    };
  }, []);

  const selectedLibraryId = selectedApp?.id || "";
  const matchingApps = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return apps.filter((app) => {
      if (libraryCategory !== "all" && app.category !== libraryCategory) return false;
      if (!query) return true;
      return `${app.name} ${app.webAppId} ${categoryLabel[app.category]}`.toLowerCase().includes(query);
    });
  }, [apps, librarySearch, libraryCategory]);

  const emitLibraryChanged = () => ctx.emit("runninghub:library-changed");

  const clearMessages = () => {
    setError("");
    setNotice("");
  };

  const selectApp = async (app: RunningHubSavedApp) => {
    clearMessages();
    const now = new Date().toISOString();
    const next = { ...app, lastUsedAt: now, useCount: (app.useCount || 0) + 1 };
    ctx.updateMetadata({
      rhApp: next,
      rhValues: initialValues(next),
      rhBindings: {},
      rhUploadNames: {},
      rhTaskId: "",
      rhTaskStatus: "",
      rhOutputKind: "",
      content: "",
      status: "idle",
      errorDetails: "",
    });
    ctx.updateNode({ title: `RunningHub · ${next.name}` });
    await markRunningHubAppUsed(ctx.storage, app.id);
    emitLibraryChanged();
    setPendingRefresh(null);
    setView("main");
  };

  const saveCredential = async () => {
    clearMessages();
    const key = apiKeyDraft.trim();
    if (!key) return setError("请输入 API Key");
    setBusy("credential");
    try {
      const info = await validateRunningHubCredential(site, key);
      await saveRunningHubCredential(ctx.storage, site, key);
      setApiKeyDraft("");
      setCredentialNote(`已验证 · ${info.currency || info.apiType || "可用"}`);
      setNotice(`${site === "cn" ? "国内站" : "国际站"} API Key 已保存`);
      await refreshLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const forgetCredential = async () => {
    await removeRunningHubCredential(ctx.storage, site);
    setHasCredential((old) => ({ ...old, [site]: false }));
    setCredentialNote("");
    setNotice("已移除当前站点 API Key");
  };

  const readApp = async () => {
    clearMessages();
    setPreviewApp(null);
    let parsed: { webAppId: string; site: RunningHubSite };
    try {
      parsed = parseRunningHubReference(reference, site);
      setSite(parsed.site);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy("read");
    try {
      let key = apiKeyDraft.trim();
      if (key) {
        await validateRunningHubCredential(parsed.site, key);
        await saveRunningHubCredential(ctx.storage, parsed.site, key);
        setApiKeyDraft("");
      } else {
        key = await getRunningHubCredential(ctx.storage, parsed.site);
      }
      if (!key) throw new Error("当前站点还没有保存 API Key");
      const app = await fetchRunningHubApp(parsed.site, key, parsed.webAppId);
      setPreviewApp(app);
      setNotice(`已读取 ${app.fields.length} 个开放参数`);
      await refreshLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const savePreview = async (useAfterSave: boolean) => {
    if (!previewApp) return;
    setBusy("save-app");
    try {
      const saved = await upsertRunningHubApp(ctx.storage, previewApp);
      emitLibraryChanged();
      await refreshLibrary();
      setNotice("应用已保存到 RunningHub 应用库");
      if (useAfterSave) await selectApp(saved);
      else setView("library");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const directUsePreview = async () => {
    if (!previewApp) return;
    await selectApp(previewApp);
  };

  const refreshAppSchema = async (app: RunningHubSavedApp, fromLibrary = false) => {
    clearMessages();
    setBusy(`refresh:${app.id}`);
    try {
      const key = await getRunningHubCredential(ctx.storage, app.site);
      if (!key) throw new Error("请先配置该站点的 API Key");
      const remote = await fetchRunningHubApp(app.site, key, app.webAppId);
      const merged = {
        ...remote,
        id: app.id,
        favorite: app.favorite,
        useCount: app.useCount,
        savedAt: app.savedAt,
        lastUsedAt: app.lastUsedAt,
      };
      await upsertRunningHubApp(ctx.storage, merged);
      emitLibraryChanged();
      await refreshLibrary();
      if (!fromLibrary && selectedApp?.id === app.id && remote.schemaHash !== selectedApp.schemaHash) {
        setPendingRefresh(merged);
        setNotice(`发现参数更新：当前 ${selectedApp.fields.length} 个 → 最新 ${remote.fields.length} 个`);
      } else {
        setNotice(remote.schemaHash === app.schemaHash ? "应用已经是最新版本" : "应用库已更新；现有画布节点保持不变");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const applyPendingRefresh = () => {
    if (!pendingRefresh) return;
    const nextValues: Values = {};
    for (const field of pendingRefresh.fields) {
      nextValues[field.key] = field.key in values ? values[field.key] : field.defaultValue;
    }
    const nextBindings = Object.fromEntries(Object.entries(bindings).filter(([key]) => pendingRefresh.fields.some((field) => field.key === key)));
    ctx.updateMetadata({
      rhApp: pendingRefresh,
      rhValues: nextValues,
      rhBindings: nextBindings,
      rhUploadNames: {},
    });
    ctx.updateNode({ title: `RunningHub · ${pendingRefresh.name}` });
    setPendingRefresh(null);
    setNotice("当前节点已经更新到最新应用参数");
  };

  const changeValue = (field: RunningHubField, value: unknown) => {
    ctx.updateMetadata({ rhValues: { ...values, [field.key]: value } });
  };

  const changeBinding = (field: RunningHubField, nodeId: string) => {
    ctx.updateMetadata({ rhBindings: { ...bindings, [field.key]: nodeId } });
    if (nodeId && !ctx.getConnections().some((connection) => connection.fromNodeId === nodeId && connection.toNodeId === ctx.node.id)) {
      ctx.applyOps([{ type: "connect_nodes", fromNodeId: nodeId, toNodeId: ctx.node.id }]);
    }
  };

  const chooseUpload = async (field: RunningHubField, file: File | null) => {
    if (!file) return;
    const storageKey = `runninghub:node-upload:${ctx.node.id}:${field.key}`;
    await ctx.storage.set(storageKey, file);
    ctx.updateMetadata({ rhUploadNames: { ...uploadNames, [field.key]: file.name } });
    setNotice(`已暂存 ${file.name}，生成时上传到 RunningHub`);
  };

  const clearUpload = async (field: RunningHubField) => {
    await ctx.storage.remove(`runninghub:node-upload:${ctx.node.id}:${field.key}`);
    const next = { ...uploadNames };
    delete next[field.key];
    ctx.updateMetadata({ rhUploadNames: next });
  };

  const resolveFieldValue = async (field: RunningHubField, apiKey: string, signal: AbortSignal) => {
    const bindingId = bindings[field.key];
    if (field.kind === "image" || field.kind === "video" || field.kind === "audio") {
      const upload = await ctx.storage.get<Blob>(`runninghub:node-upload:${ctx.node.id}:${field.key}`);
      if (upload instanceof Blob) {
        return uploadRunningHubBlob(selectedApp!.site, apiKey, upload, filenameForBlob(upload, field, uploadNames[field.key]), signal);
      }
      if (bindingId) {
        const source = ctx.getNode(bindingId);
        if (!source) throw new Error(`${field.label} 绑定的上游节点已经不存在`);
        const blob = await blobFromCanvasNode(source, signal);
        return uploadRunningHubBlob(selectedApp!.site, apiKey, blob, filenameForBlob(blob, field, source.title), signal);
      }
      return values[field.key] ?? field.defaultValue;
    }
    if (bindingId) {
      const source = ctx.getNode(bindingId);
      if (!source) throw new Error(`${field.label} 绑定的上游节点已经不存在`);
      return stringMetadata(source.metadata?.content || source.metadata?.prompt);
    }
    return values[field.key] ?? field.defaultValue;
  };

  const publishOutputs = (outputs: any[], sourceTaskId = lastTaskId) => {
    if (!selectedApp || !Array.isArray(outputs)) return;
    const now = Date.now();
    const ops: any[] = [];
    let firstContent = "";
    let firstKind: "image" | "video" | "audio" | "text" = "text";

    outputs.forEach((output: any, index: number) => {
      const kind = outputKind(output);
      const content = output.url || output.text || JSON.stringify(output.raw ?? output);
      if (!content) return;
      if (!firstContent) {
        firstContent = content;
        firstKind = kind;
      }
      const id = `rh-${ctx.node.id}-${now}-${index}`;
      const width = kind === "video" ? 420 : kind === "image" ? 340 : 340;
      const height = kind === "video" ? 236 : kind === "image" ? 240 : kind === "audio" ? 120 : 240;
      ops.push({
        type: "add_node",
        id,
        nodeType: kind,
        title: `${selectedApp.name} · 结果${index + 1}`,
        x: ctx.node.position.x + ctx.node.width + 80,
        y: ctx.node.position.y + index * (height + 30),
        width,
        height,
        metadata: { content, status: "success", rhTaskId: sourceTaskId, rhSourceAppId: selectedApp.id },
      });
      ops.push({ type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id });
    });
    if (ops.length) ctx.applyOps(ops);
    if (firstContent) ctx.updateMetadata({ content: firstContent, rhOutputKind: firstKind });
  };

  const observeTask = async (taskId: string, apiKey: string, controller: AbortController) => {
    const terminal = await pollRunningHubTask(selectedApp!.site, apiKey, taskId, (state) => {
      setTaskState(state);
      ctx.updateMetadata({ rhTaskStatus: state.status, status: state.state === "pending" ? "loading" : state.state === "success" ? "success" : "error" });
    }, controller.signal);
    if (terminal.state === "failed") {
      ctx.updateMetadata({ status: "error", errorDetails: terminal.reason, rhTaskStatus: terminal.status });
      throw new Error(terminal.reason);
    }
    publishOutputs(terminal.outputs, taskId);
    ctx.updateMetadata({ status: "success", errorDetails: "", rhTaskStatus: terminal.status });
    return terminal;
  };

  const run = async () => {
    if (!selectedApp) return;
    clearMessages();
    runControllerRef.current?.abort();
    const controller = new AbortController();
    runControllerRef.current = controller;
    setBusy("run");
    setTaskState({ state: "pending", status: "PREPARING", outputs: [] });
    ctx.updateMetadata({ status: "loading", errorDetails: "", rhTaskStatus: "PREPARING" });
    try {
      const apiKey = await getRunningHubCredential(ctx.storage, selectedApp.site);
      if (!apiKey) throw new Error("请先配置该站点的 API Key");
      const nodeInfoList = [];
      for (const field of selectedApp.fields) {
        const fieldValue = await resolveFieldValue(field, apiKey, controller.signal);
        if (field.required && (fieldValue === "" || fieldValue === undefined || fieldValue === null)) throw new Error(`必填参数“${field.label}”不能为空`);
        nodeInfoList.push({
          nodeId: field.nodeId,
          fieldName: field.fieldName,
          fieldValue,
          ...(field.description ? { description: field.description } : {}),
        });
      }
      setTaskState({ state: "pending", status: "SUBMITTING", outputs: [] });
      const task = await startRunningHubTask(selectedApp.site, apiKey, selectedApp.webAppId, nodeInfoList, controller.signal);
      ctx.updateMetadata({ rhTaskId: task.taskId, rhTaskStatus: task.status });
      setTaskState({ state: "pending", status: task.status, outputs: [] });
      await markRunningHubAppUsed(ctx.storage, selectedApp.id);
      emitLibraryChanged();
      await observeTask(task.taskId, apiKey, controller);
      setNotice("RunningHub 任务完成，结果已添加到画布");
    } catch (e) {
      if (controller.signal.aborted) {
        setNotice("已停止本地查询；RunningHub 云端任务可能仍在继续");
        ctx.updateMetadata({ status: "idle", rhTaskStatus: "POLLING_STOPPED" });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        ctx.updateMetadata({ status: "error", errorDetails: msg });
      }
    } finally {
      if (runControllerRef.current === controller) runControllerRef.current = null;
      setBusy("");
    }
  };

  const resume = async () => {
    if (!selectedApp || !lastTaskId) return;
    clearMessages();
    const controller = new AbortController();
    runControllerRef.current = controller;
    setBusy("run");
    try {
      const apiKey = await getRunningHubCredential(ctx.storage, selectedApp.site);
      if (!apiKey) throw new Error("请先配置该站点的 API Key");
      const first = await queryRunningHubTask(selectedApp.site, apiKey, lastTaskId, controller.signal);
      setTaskState(first);
      if (first.state === "success") {
        publishOutputs(first.outputs, lastTaskId);
        ctx.updateMetadata({ status: "success", rhTaskStatus: first.status });
      } else if (first.state === "failed") {
        throw new Error(first.reason);
      } else {
        await observeTask(lastTaskId, apiKey, controller);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (runControllerRef.current === controller) runControllerRef.current = null;
      setBusy("");
    }
  };

  const stop = () => runControllerRef.current?.abort();

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box" as const,
    border: `1px solid ${ctx.theme.node.stroke}`,
    borderRadius: 8,
    background: ctx.theme.node.panel,
    color: ctx.theme.node.text,
    outline: "none",
    fontSize: 11,
  };

  const sectionStyle = {
    border: `1px solid ${ctx.theme.node.stroke}`,
    borderRadius: 10,
    padding: 10,
    background: ctx.theme.node.fill,
  };

  const fieldNodeOptions = (field: RunningHubField) => allNodes
    .filter((node) => node.id !== ctx.node.id && compatibleKind(field.kind, node))
    .sort((a, b) => Number(upstream.some((item) => item.id === b.id)) - Number(upstream.some((item) => item.id === a.id)));

  const renderField = (field: RunningHubField) => {
    const nodeOptions = fieldNodeOptions(field);
    const value = values[field.key] ?? field.defaultValue;
    const bindingId = bindings[field.key] || "";
    const media = field.kind === "image" || field.kind === "video" || field.kind === "audio";
    return (
      <div key={field.key} style={{ ...sectionStyle, display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <strong style={{ fontSize: 11 }}>{field.label}{field.required ? " *" : ""}</strong>
          <span style={{ fontSize: 9, color: ctx.theme.node.muted }}>{field.nodeId}:{field.fieldName}</span>
        </div>
        {field.description && field.description !== field.label ? <div style={{ fontSize: 9, color: ctx.theme.node.muted }}>{field.description}</div> : null}

        {media ? (
          <>
            <select
              value={bindingId}
              onChange={(event) => changeBinding(field, event.target.value)}
              style={{ ...inputStyle, height: 30, padding: "0 7px" }}
            >
              <option value="">不绑定上游（使用应用默认值）</option>
              {nodeOptions.map((node) => <option key={node.id} value={node.id}>{upstream.some((item) => item.id === node.id) ? "已连接 · " : ""}{node.title}</option>)}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ flex: 1, cursor: "pointer", border: `1px dashed ${ctx.theme.node.stroke}`, borderRadius: 8, padding: "6px 8px", fontSize: 10, color: ctx.theme.node.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {uploadNames[field.key] || "选择本地文件"}
                <input
                  type="file"
                  accept={field.kind === "image" ? "image/*" : field.kind === "video" ? "video/*" : "audio/*"}
                  style={{ display: "none" }}
                  onChange={(event) => void chooseUpload(field, event.target.files?.[0] || null)}
                />
              </label>
              {uploadNames[field.key] ? <Button compact onClick={() => void clearUpload(field)}>清除</Button> : null}
            </div>
            {bindingId && uploadNames[field.key] ? <div style={{ fontSize: 9, color: "#f59e0b" }}>本地文件优先于上游绑定</div> : null}
          </>
        ) : (
          <>
            {nodeOptions.length ? (
              <select
                value={bindingId}
                onChange={(event) => changeBinding(field, event.target.value)}
                style={{ ...inputStyle, height: 28, padding: "0 7px" }}
              >
                <option value="">手动填写</option>
                {nodeOptions.map((node) => <option key={node.id} value={node.id}>{upstream.some((item) => item.id === node.id) ? "已连接 · " : ""}{node.title}</option>)}
              </select>
            ) : null}
            {!bindingId && field.kind === "select" ? (
              <select value={String(value ?? "")} onChange={(event) => {
                const option = field.options.find((item) => String(item.value) === event.target.value);
                changeValue(field, option?.value ?? event.target.value);
              }} style={{ ...inputStyle, height: 30, padding: "0 7px" }}>
                {field.options.map((option) => <option key={JSON.stringify(option.value)} value={String(option.value)}>{option.label}</option>)}
              </select>
            ) : null}
            {!bindingId && field.kind === "boolean" ? (
              <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 10 }}>
                <input type="checkbox" checked={Boolean(value)} onChange={(event) => changeValue(field, event.target.checked)} />
                {Boolean(value) ? "开启" : "关闭"}
              </label>
            ) : null}
            {!bindingId && (field.kind === "int" || field.kind === "float") ? (
              <input
                type="number"
                value={typeof value === "number" || typeof value === "string" ? value : ""}
                min={field.minimum ?? undefined}
                max={field.maximum ?? undefined}
                step={field.step ?? (field.kind === "int" ? 1 : "any")}
                onChange={(event) => changeValue(field, field.kind === "int" ? Math.trunc(Number(event.target.value)) : Number(event.target.value))}
                style={{ ...inputStyle, height: 30, padding: "0 8px" }}
              />
            ) : null}
            {!bindingId && field.kind === "text" ? (
              <textarea
                value={String(value ?? "")}
                onChange={(event) => changeValue(field, event.target.value)}
                rows={Math.min(6, Math.max(2, String(value ?? "").length > 100 ? 4 : 2))}
                style={{ ...inputStyle, resize: "vertical", padding: 8, lineHeight: 1.45 }}
              />
            ) : null}
            {bindingId ? <div style={{ fontSize: 9, color: ctx.theme.node.muted }}>运行时读取绑定节点的文本内容</div> : null}
          </>
        )}
      </div>
    );
  };

  const renderAdd = () => (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>添加 RunningHub 应用</strong>
        <Button compact onClick={() => setView("main")}>返回</Button>
      </div>
      <div style={sectionStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10 }}>站点</span>
          <select value={site} onChange={(event) => setSite(event.target.value as RunningHubSite)} style={{ ...inputStyle, height: 30, padding: "0 7px" }}>
            <option value="cn">RunningHub 国内站</option>
            <option value="global">RunningHub 国际站</option>
          </select>
          <span style={{ fontSize: 10 }}>API Key</span>
          <input
            type="password"
            value={apiKeyDraft}
            placeholder={hasCredential[site] ? "已保存；留空继续使用已保存密钥" : "输入 API Key"}
            onChange={(event) => setApiKeyDraft(event.target.value)}
            style={{ ...inputStyle, height: 30, padding: "0 8px" }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <Button onClick={() => void saveCredential()} disabled={busy === "credential"}>{busy === "credential" ? "验证中…" : "验证并保存 Key"}</Button>
          {hasCredential[site] ? <Button danger compact onClick={() => void forgetCredential()}>移除 Key</Button> : null}
          <span style={{ fontSize: 9, color: ctx.theme.node.muted }}>{credentialNote || (hasCredential[site] ? "已配置" : "未配置")}</span>
        </div>
      </div>
      <div style={sectionStyle}>
        <div style={{ fontSize: 10, marginBottom: 6 }}>应用 ID / 应用链接</div>
        <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="输入 WebAppId，或粘贴 RunningHub 应用链接" style={{ ...inputStyle, height: 32, padding: "0 8px" }} />
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button onClick={() => void readApp()} disabled={busy === "read"}>{busy === "read" ? "正在读取…" : "读取应用"}</Button>
        </div>
      </div>
      {previewApp ? (
        <div style={{ ...sectionStyle, display: "grid", gap: 7 }}>
          <strong style={{ fontSize: 12 }}>{previewApp.name}</strong>
          <div style={{ fontSize: 9, color: ctx.theme.node.muted }}>{previewApp.site === "cn" ? "国内站" : "国际站"} · {categoryLabel[previewApp.category]} · {previewApp.fields.length} 个开放参数 · ID {previewApp.webAppId}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button onClick={() => void savePreview(true)} disabled={busy === "save-app"}>保存并使用</Button>
            <Button onClick={() => void savePreview(false)} disabled={busy === "save-app"}>只保存</Button>
            <Button onClick={() => void directUsePreview()}>仅本次使用</Button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const renderLibrary = () => (
    <div style={{ display: "grid", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>RunningHub 应用库</strong>
        <Button compact onClick={() => setView("main")}>返回</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 6 }}>
        <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="搜索名称 / ID" style={{ ...inputStyle, height: 30, padding: "0 8px" }} />
        <select value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value as any)} style={{ ...inputStyle, height: 30, padding: "0 6px" }}>
          <option value="all">全部类型</option>
          {Object.entries(categoryLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {matchingApps.length === 0 ? <div style={{ ...sectionStyle, textAlign: "center", fontSize: 10, color: ctx.theme.node.muted }}>暂无匹配应用</div> : null}
        {matchingApps.map((app) => (
          <div key={app.id} style={{ ...sectionStyle, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => void (async () => {
                  await patchRunningHubApp(ctx.storage, app.id, { favorite: !app.favorite });
                  emitLibraryChanged();
                  await refreshLibrary();
                })()}
                style={{ border: 0, background: "transparent", color: app.favorite ? "#f59e0b" : ctx.theme.node.muted, cursor: "pointer", padding: 0 }}
              >
                {app.favorite ? "★" : "☆"}
              </button>
              <strong style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.name}</strong>
              <span style={{ fontSize: 9, color: ctx.theme.node.muted }}>{categoryLabel[app.category]}</span>
            </div>
            <div style={{ fontSize: 9, color: ctx.theme.node.muted }}>{app.site === "cn" ? "CN" : "AI"} · {app.fields.length} 参数 · {app.webAppId}</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <Button compact onClick={() => void selectApp(app)}>使用</Button>
              <Button compact disabled={busy === `refresh:${app.id}`} onClick={() => void refreshAppSchema(app, true)}>{busy === `refresh:${app.id}` ? "刷新中…" : "刷新"}</Button>
              <Button compact onClick={() => void (async () => {
                const nextName = window.prompt("应用名称", app.name)?.trim();
                if (!nextName || nextName === app.name) return;
                await patchRunningHubApp(ctx.storage, app.id, { name: nextName.slice(0, 160) });
                emitLibraryChanged();
                await refreshLibrary();
              })()}>改名</Button>
              <Button compact danger onClick={() => void (async () => {
                if (!window.confirm(`删除应用“${app.name}”？现有画布节点不会被删除。`)) return;
                await deleteRunningHubApp(ctx.storage, app.id);
                emitLibraryChanged();
                await refreshLibrary();
              })()}>删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderMain = () => {
    if (!selectedApp) {
      return (
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <strong style={{ fontSize: 14 }}>RunningHub</strong>
            <div style={{ fontSize: 9, color: ctx.theme.node.muted, marginTop: 3 }}>选择保存的 AI 应用，或输入 WebAppId 拉取新应用。</div>
          </div>
          <div style={sectionStyle}>
            <div style={{ fontSize: 10, marginBottom: 6 }}>常用应用</div>
            <select
              value=""
              disabled={loadingLibrary || apps.length === 0}
              onChange={(event) => {
                const app = apps.find((item) => item.id === event.target.value);
                if (app) void selectApp(app);
              }}
              style={{ ...inputStyle, height: 34, padding: "0 8px" }}
            >
              <option value="">{loadingLibrary ? "正在读取应用库…" : apps.length ? "选择一个保存的应用…" : "还没有保存应用"}</option>
              {apps.map((app) => <option key={app.id} value={app.id}>{app.favorite ? "★ " : ""}{app.name} · {app.site === "cn" ? "CN" : "AI"}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            <Button onClick={() => setView("add")}>＋ 添加应用</Button>
            <Button onClick={() => setView("library")}>管理应用库</Button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 13, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedApp.name}</strong>
            <div style={{ fontSize: 9, color: ctx.theme.node.muted, marginTop: 2 }}>
              {selectedApp.site === "cn" ? "RunningHub CN" : "RunningHub AI"} · {categoryLabel[selectedApp.category]} · {selectedApp.fields.length} 参数
            </div>
          </div>
          <Button compact onClick={() => {
            ctx.updateMetadata({ rhApp: null, rhValues: {}, rhBindings: {}, rhUploadNames: {} });
            ctx.updateNode({ title: "RunningHub" });
            setPendingRefresh(null);
          }}>更换</Button>
          <Button compact onClick={() => setView("library")}>应用库</Button>
        </div>

        {pendingRefresh ? (
          <div style={{ ...sectionStyle, borderColor: "#f59e0b", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 10 }}>远程应用参数已变化，当前节点尚未自动修改。</div>
            <div><Button compact onClick={applyPendingRefresh}>更新当前节点</Button></div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Button compact disabled={busy === `refresh:${selectedApp.id}`} onClick={() => void refreshAppSchema(selectedApp)}>{busy === `refresh:${selectedApp.id}` ? "刷新中…" : "刷新应用"}</Button>
          <span style={{ fontSize: 9, color: ctx.theme.node.muted }}>ID {selectedApp.webAppId}</span>
        </div>

        <div style={{ display: "grid", gap: 7 }}>
          {selectedApp.fields.map(renderField)}
        </div>

        <div style={{ ...sectionStyle, display: "grid", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {busy === "run" ? <Button danger onClick={stop}>停止查询</Button> : <Button onClick={() => void run()}>▶ 生成</Button>}
            {busy !== "run" && lastTaskId && !["SUCCESS", "COMPLETED"].includes(lastStatus) ? <Button compact onClick={() => void resume()}>继续查询</Button> : null}
          </div>
          {(taskState || lastStatus || lastTaskId) ? (
            <div style={{ fontSize: 9, color: ctx.theme.node.muted, lineHeight: 1.5 }}>
              状态：{taskState?.status || lastStatus || "—"}{lastTaskId ? ` · Task ${lastTaskId}` : ""}
            </div>
          ) : null}
        </div>
      </div>
    );
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
        overflow: "auto",
        color: ctx.theme.node.text,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {view === "add" ? renderAdd() : view === "library" ? renderLibrary() : renderMain()}
      {notice ? <div style={{ marginTop: 8, padding: "7px 9px", borderRadius: 8, background: "#22c55e18", color: "#16a34a", fontSize: 10, lineHeight: 1.45 }}>{notice}</div> : null}
      {error ? <div style={{ marginTop: 8, padding: "7px 9px", borderRadius: 8, background: "#ef444418", color: "#ef4444", fontSize: 10, lineHeight: 1.45 }}>{error}</div> : null}
      {selectedApp && !hasCredential[selectedApp.site] ? (
        <div style={{ marginTop: 8, padding: "7px 9px", borderRadius: 8, background: "#f59e0b18", color: "#d97706", fontSize: 10 }}>
          当前站点尚未配置 API Key。请进入“更换 → 添加应用”配置。
        </div>
      ) : null}
    </div>
  );
}

export const runningHubNode: CanvasNodeDefinition = {
  type: "node-pack:runninghub",
  title: "RunningHub",
  icon: "☁️",
  description: "拉取、保存并运行 RunningHub AI 应用。支持动态参数、应用库、媒体上传和任务结果输出。",
  defaultSize: { width: 500, height: 620 },
  defaultMetadata: {
    content: "",
    status: "idle",
    rhApp: null,
    rhValues: {},
    rhBindings: {},
    rhUploadNames: {},
    rhTaskId: "",
    rhTaskStatus: "",
    rhOutputKind: "",
  },
  minimapColor: "#22c55e",
  resource: nodeResourceForRunningHub,
  Content: RunningHubContent,
};
