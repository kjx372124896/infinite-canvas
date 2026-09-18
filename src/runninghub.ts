import type { CanvasNodeData, CanvasNodeResource, PluginStorage } from "@infinite-canvas/plugin-sdk";

export type RunningHubSite = "cn" | "global";
export type RunningHubCategory = "image" | "video" | "audio" | "motion" | "other";
export type RunningHubFieldKind = "image" | "video" | "audio" | "text" | "boolean" | "int" | "float" | "select";

export type RunningHubOption = {
  value: string | number | boolean;
  label: string;
  description?: string;
};

export type RunningHubField = {
  key: string;
  nodeId: string;
  fieldName: string;
  label: string;
  description: string;
  kind: RunningHubFieldKind;
  required: boolean;
  defaultValue: unknown;
  options: RunningHubOption[];
  minimum: number | null;
  maximum: number | null;
  step: number | null;
};

export type RunningHubSavedApp = {
  id: string;
  site: RunningHubSite;
  webAppId: string;
  name: string;
  description: string;
  category: RunningHubCategory;
  fields: RunningHubField[];
  schemaHash: string;
  favorite: boolean;
  useCount: number;
  savedAt: string;
  lastUsedAt: string;
  lastSyncedAt: string;
};

export type RunningHubOutput = {
  url?: string;
  text?: string;
  fileType?: string;
  raw: unknown;
};

export type RunningHubTaskState =
  | { state: "pending"; status: string; outputs: [] }
  | { state: "success"; status: string; outputs: RunningHubOutput[] }
  | { state: "failed"; status: string; outputs: []; reason: string };

const APP_LIBRARY_KEY = "runninghub:app-library:v1";
const credentialKey = (site: RunningHubSite) => `runninghub:credential:${site}:v1`;

export const RUNNINGHUB_BASE_URL: Record<RunningHubSite, string> = {
  cn: "https://www.runninghub.cn",
  global: "https://www.runninghub.ai",
};

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").replace(/[\0\r\n\u0001-\u001f]+/g, " ").trim().slice(0, max);
}

function safeId(value: unknown, label = "ID") {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(id)) throw new Error(`${label} 格式无效`);
  return id;
}

function stableHash(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseRunningHubReference(value: string, fallbackSite: RunningHubSite): { webAppId: string; site: RunningHubSite } {
  const normalized = value.trim();
  if (!normalized) throw new Error("请输入 RunningHub 应用 ID 或应用链接");
  if (!normalized.includes("://")) return { webAppId: safeId(normalized, "应用 ID"), site: fallbackSite };

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("RunningHub 应用链接格式无效");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "runninghub.cn" && host !== "runninghub.ai") throw new Error("仅支持 runninghub.cn / runninghub.ai");
  const pathname = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/iu, "");
  const match = /^\/ai-detail\/([A-Za-z0-9._-]{1,200})\/?$/.exec(pathname)
    || /^\/call-api\/api-detail\/([A-Za-z0-9._-]{1,200})\/?$/.exec(pathname);
  if (!match) throw new Error("请粘贴 AI 应用详情链接、API 手册链接，或直接输入应用 ID");
  return { webAppId: match[1], site: host === "runninghub.ai" ? "global" : "cn" };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 60_000) {
  const controller = new AbortController();
  const parent = init.signal;
  const onAbort = () => controller.abort();
  parent?.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`RunningHub 返回了非 JSON 响应（HTTP ${response.status}）`);
    }
    if (!response.ok) throw new Error(cleanText(data?.msg || data?.message || `HTTP ${response.status}`));
    return data;
  } catch (error) {
    if (controller.signal.aborted && !parent?.aborted) throw new Error("RunningHub 请求超时");
    throw error;
  } finally {
    window.clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}

function requireSuccess(result: any) {
  if (result?.code !== undefined && Number(result.code) !== 0) {
    const code = Number(result.code);
    if (code === 804) return result;
    throw new Error(cleanText(result?.msg || result?.message || `RunningHub 错误 ${code}`));
  }
  return result;
}

export async function validateRunningHubCredential(site: RunningHubSite, apiKey: string, signal?: AbortSignal) {
  if (!apiKey.trim()) throw new Error("请输入 RunningHub API Key");
  const result = requireSuccess(await fetchJson(`${RUNNINGHUB_BASE_URL[site]}/uc/openapi/accountStatus`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ apikey: apiKey.trim() }),
    signal,
  }, 30_000));
  return {
    currency: cleanText(result?.data?.currency, 32),
    apiType: cleanText(result?.data?.apiType, 64),
  };
}

function parseFieldData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fieldDataSettings(raw: unknown) {
  const decoded = parseFieldData(raw);
  if (!Array.isArray(decoded)) return decoded && typeof decoded === "object" ? decoded as Record<string, unknown> : {};
  const settings = decoded[1];
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
}

function fieldOptions(raw: any): RunningHubOption[] {
  const decoded = parseFieldData(raw?.fieldData);
  const fieldDataOptions = Array.isArray(decoded)
    && decoded.length >= 2
    && decoded[1]
    && typeof decoded[1] === "object"
    && !Array.isArray(decoded[1])
    ? decoded[1] as Record<string, unknown>
    : decoded;
  const typeTokens = new Set(["STRING", "BOOLEAN", "BOOL", "INT", "INTEGER", "FLOAT", "DOUBLE", "NUMBER", "IMAGE", "VIDEO", "AUDIO", "COMBO", "SELECT", "LIST", "ENUM"]);
  const decodedArrayIsTypeDescriptor = Array.isArray(fieldDataOptions)
    && typeof fieldDataOptions[0] === "string"
    && typeTokens.has(String(fieldDataOptions[0]).toUpperCase());
  const sources = [
    raw?.options,
    raw?.choices,
    raw?.values,
    raw?.list,
    fieldDataOptions && typeof fieldDataOptions === "object" && !Array.isArray(fieldDataOptions) ? (fieldDataOptions as any).options : null,
    fieldDataOptions && typeof fieldDataOptions === "object" && !Array.isArray(fieldDataOptions) ? (fieldDataOptions as any).choices : null,
    fieldDataOptions && typeof fieldDataOptions === "object" && !Array.isArray(fieldDataOptions) ? (fieldDataOptions as any).values : null,
    fieldDataOptions && typeof fieldDataOptions === "object" && !Array.isArray(fieldDataOptions) ? (fieldDataOptions as any).list : null,
    Array.isArray(fieldDataOptions) && !decodedArrayIsTypeDescriptor ? fieldDataOptions : null,
    Array.isArray((decoded as any)?.[0]) ? (decoded as any)[0] : null,
  ];
  const list = sources.find(Array.isArray) as unknown[] | undefined;
  if (!list) return [];
  const options: RunningHubOption[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, 500)) {
    if (item && typeof item === "object" && !Array.isArray(item) && "default" in (item as any) && !("index" in (item as any)) && !("value" in (item as any))) continue;
    let value: unknown;
    let label = "";
    let description = "";
    if (["string", "number", "boolean"].includes(typeof item)) {
      value = item;
      label = String(item);
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as any;
      value = obj.value ?? obj.id ?? obj.index ?? obj.key ?? obj.name ?? obj.label;
      label = cleanText(obj.label ?? obj.name ?? obj.title ?? obj.description ?? value, 160);
      description = cleanText(obj.description, 500);
    }
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: value as string | number | boolean, label: label || String(value), ...(description ? { description } : {}) });
  }
  return options;
}

function inferFieldKind(raw: any, options: RunningHubOption[]): RunningHubFieldKind {
  const settings = fieldDataSettings(raw?.fieldData) as any;
  if (settings?.image_upload === true || raw?.image_upload === true) return "image";
  if (settings?.video_upload === true || raw?.video_upload === true) return "video";
  if (settings?.audio_upload === true || raw?.audio_upload === true) return "audio";
  const declared = `${raw?.fieldType || ""} ${raw?.valueType || ""}`.toLowerCase();
  const name = String(raw?.fieldName || raw?.name || "").toLowerCase();
  const description = `${raw?.description || ""} ${raw?.label || ""}`.toLowerCase();
  if (/video|movie/.test(declared)) return "video";
  if (/audio|sound|voice|music/.test(declared)) return "audio";
  if (/image|picture|photo|mask/.test(declared)) return "image";
  if (/(^|[_-])(video|movie)([_-]|$)|视频文件|视频输入/.test(name)) return "video";
  if (/(^|[_-])(audio|sound|voice|music)([_-]|$)|音频文件|音频输入/.test(name)) return "audio";
  if (/(^|[_-])(image|img|picture|photo|mask|first_frame|last_frame)([_-]|$)|图片|图像|首帧|尾帧/.test(name)) return "image";
  if (/上传.{0,4}(视频|影片)|视频.{0,4}(上传|素材输入)/.test(description)) return "video";
  if (/上传.{0,4}(音频|声音|语音)|音频.{0,4}(上传|素材输入)/.test(description)) return "audio";
  if (/上传.{0,4}(图片|图像|照片)|图片.{0,4}(上传|素材输入)|图像.{0,4}(上传|素材输入)|首帧图片|尾帧图片/.test(description)) return "image";
  if (/boolean|bool|toggle/.test(declared)) return "boolean";
  if (/int|integer/.test(declared)) return "int";
  if (/float|double|number/.test(declared)) return "float";
  if (/combo|select|list|enum/.test(declared) || options.length) return "select";
  const value = raw?.fieldValue ?? raw?.defaultValue ?? raw?.value;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  return "text";
}

function defaultValueFor(raw: any, kind: RunningHubFieldKind, options: RunningHubOption[]) {
  const settings = fieldDataSettings(raw?.fieldData) as any;
  const value = raw?.fieldValue ?? raw?.defaultValue ?? raw?.value ?? settings?.default;
  if (kind === "select") {
    const exact = options.find((option) => Object.is(option.value, value));
    return exact?.value ?? options[0]?.value ?? "";
  }
  if (kind === "boolean") return typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
  if (kind === "int") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  if (kind === "float") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function projectFields(rawFields: any[]): RunningHubField[] {
  const seen = new Set<string>();
  const fields: RunningHubField[] = [];
  for (const raw of rawFields.slice(0, 256)) {
    const nodeId = String(raw?.nodeId ?? raw?.id ?? "").trim();
    const fieldName = String(raw?.fieldName ?? raw?.name ?? "").trim();
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(nodeId) || !/^[A-Za-z0-9._-]{1,160}$/.test(fieldName)) continue;
    const key = `${nodeId}:${fieldName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const options = fieldOptions(raw);
    const kind = inferFieldKind(raw, options);
    const settings = fieldDataSettings(raw?.fieldData) as any;
    const number = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    fields.push({
      key,
      nodeId,
      fieldName,
      label: cleanText(raw?.label || raw?.name || raw?.description || fieldName, 160) || fieldName,
      description: cleanText(raw?.description, 600),
      kind,
      required: raw?.required === true || settings?.required === true,
      defaultValue: defaultValueFor(raw, kind, options),
      options,
      minimum: number(raw?.min ?? settings?.min),
      maximum: number(raw?.max ?? settings?.max),
      step: number(raw?.step ?? settings?.step),
    });
  }
  if (!fields.length) throw new Error("RunningHub 应用没有返回可用的开放参数");
  return fields;
}

function inferCategory(name: string, fields: RunningHubField[]): RunningHubCategory {
  const text = `${name} ${fields.map((field) => `${field.fieldName} ${field.label}`).join(" ")}`.toLowerCase();
  if (/motion|pose|动作|姿态|驱动/.test(text)) return "motion";
  if (/video|movie|film|视频|影片|图生视频|文生视频/.test(text)) return "video";
  if (/audio|sound|voice|speech|music|音频|语音|配音|音乐/.test(text)) return "audio";
  if (/image|picture|photo|draw|图像|图片|绘图|海报/.test(text)) return "image";
  if (fields.some((field) => field.kind === "video")) return "video";
  if (fields.some((field) => field.kind === "audio")) return "audio";
  if (fields.some((field) => field.kind === "image")) return "image";
  return "other";
}

function extractCurlPayload(curl: string): any | null {
  const first = curl.indexOf("{");
  const last = curl.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const json = curl.slice(first, last + 1);
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function appFromInfo(site: RunningHubSite, webAppId: string, info: any, now = new Date().toISOString()): RunningHubSavedApp {
  const rawFields = Array.isArray(info?.nodeInfoList)
    ? info.nodeInfoList
    : Array.isArray(info?.inputNodes)
      ? info.inputNodes
      : [];
  const fields = projectFields(rawFields);
  const name = cleanText(info?.appName || info?.webappName || info?.name || info?.title, 160) || `RunningHub ${webAppId}`;
  const schemaCore = fields.map((field) => ({
    key: field.key,
    nodeId: field.nodeId,
    fieldName: field.fieldName,
    kind: field.kind,
    required: field.required,
    defaultValue: field.defaultValue,
    options: field.options,
    minimum: field.minimum,
    maximum: field.maximum,
    step: field.step,
  }));
  return {
    id: `${site}:${webAppId}`,
    site,
    webAppId,
    name,
    description: cleanText(info?.description || info?.desc, 600),
    category: inferCategory(name, fields),
    fields,
    schemaHash: stableHash(schemaCore),
    favorite: false,
    useCount: 0,
    savedAt: now,
    lastUsedAt: "",
    lastSyncedAt: now,
  };
}

async function fetchPublicDetail(site: RunningHubSite, webAppId: string, signal?: AbortSignal) {
  try {
    const result = await fetchJson(`${RUNNINGHUB_BASE_URL[site]}/api/webapp/detail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5" },
      body: JSON.stringify({ webappId: webAppId }),
      signal,
    }, 30_000);
    if (Number(result?.code) === 0 && result?.data && Array.isArray(result.data.inputNodes)) {
      return {
        appName: result.data.name,
        name: result.data.name,
        description: result.data.description,
        category: result.data.category,
        tags: result.data.tags,
        nodeInfoList: result.data.inputNodes,
      };
    }
  } catch {
    // Fallback to authenticated apiCallDemo.
  }
  return null;
}

export async function fetchRunningHubApp(site: RunningHubSite, apiKey: string, webAppIdInput: string, signal?: AbortSignal) {
  const webAppId = safeId(webAppIdInput, "应用 ID");
  if (!apiKey.trim()) throw new Error("请先配置当前站点的 RunningHub API Key");

  const detail = await fetchPublicDetail(site, webAppId, signal);
  if (detail) return appFromInfo(site, webAppId, detail);

  const url = new URL(`${RUNNINGHUB_BASE_URL[site]}/api/webapp/apiCallDemo`);
  url.searchParams.set("apiKey", apiKey.trim());
  url.searchParams.set("webappId", webAppId);
  const result = requireSuccess(await fetchJson(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: "application/json",
    },
    signal,
  }, 60_000));

  const data = result?.data;
  let info: any = data && typeof data === "object" ? { ...data } : {};
  if (!Array.isArray(info.nodeInfoList) && typeof data?.curl === "string") {
    const payload = extractCurlPayload(data.curl);
    if (payload && Array.isArray(payload.nodeInfoList)) info = { ...info, ...payload, nodeInfoList: payload.nodeInfoList };
  }
  return appFromInfo(site, webAppId, info);
}

export async function saveRunningHubCredential(storage: PluginStorage, site: RunningHubSite, apiKey: string) {
  const key = apiKey.trim();
  if (!key) throw new Error("API Key 不能为空");
  await storage.set(credentialKey(site), key);
}

export async function getRunningHubCredential(storage: PluginStorage, site: RunningHubSite) {
  return (await storage.get<string>(credentialKey(site)))?.trim() || "";
}

export async function removeRunningHubCredential(storage: PluginStorage, site: RunningHubSite) {
  await storage.remove(credentialKey(site));
}

export async function loadRunningHubApps(storage: PluginStorage) {
  const list = await storage.get<RunningHubSavedApp[]>(APP_LIBRARY_KEY);
  if (!Array.isArray(list)) return [];
  return list
    .filter((app) => app && typeof app === "object" && app.id && app.webAppId && Array.isArray(app.fields))
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
      || String(b.lastUsedAt || b.savedAt).localeCompare(String(a.lastUsedAt || a.savedAt)));
}

export async function saveRunningHubApps(storage: PluginStorage, apps: RunningHubSavedApp[]) {
  await storage.set(APP_LIBRARY_KEY, apps.slice(0, 300));
}

export async function upsertRunningHubApp(storage: PluginStorage, app: RunningHubSavedApp) {
  const apps = await loadRunningHubApps(storage);
  const existing = apps.find((item) => item.id === app.id);
  const next: RunningHubSavedApp = {
    ...app,
    favorite: existing?.favorite ?? app.favorite,
    useCount: existing?.useCount ?? app.useCount,
    savedAt: existing?.savedAt || app.savedAt,
    lastUsedAt: existing?.lastUsedAt || app.lastUsedAt,
  };
  await saveRunningHubApps(storage, [next, ...apps.filter((item) => item.id !== app.id)]);
  return next;
}

export async function deleteRunningHubApp(storage: PluginStorage, id: string) {
  const apps = await loadRunningHubApps(storage);
  await saveRunningHubApps(storage, apps.filter((app) => app.id !== id));
}

export async function patchRunningHubApp(storage: PluginStorage, id: string, patch: Partial<RunningHubSavedApp>) {
  const apps = await loadRunningHubApps(storage);
  const next = apps.map((app) => app.id === id ? { ...app, ...patch, id: app.id, webAppId: app.webAppId, site: app.site } : app);
  await saveRunningHubApps(storage, next);
  return next.find((app) => app.id === id) || null;
}

export async function markRunningHubAppUsed(storage: PluginStorage, id: string) {
  const apps = await loadRunningHubApps(storage);
  const now = new Date().toISOString();
  const next = apps.map((app) => app.id === id ? { ...app, useCount: (app.useCount || 0) + 1, lastUsedAt: now } : app);
  await saveRunningHubApps(storage, next);
}

export async function uploadRunningHubBlob(site: RunningHubSite, apiKey: string, blob: Blob, filename: string, signal?: AbortSignal) {
  if (!blob.size) throw new Error("上传文件为空");
  if (blob.size > 30 * 1024 * 1024) throw new Error("RunningHub 单个上传素材不能超过 30 MiB");
  const form = new FormData();
  form.append("apiKey", apiKey.trim());
  form.append("fileType", "input");
  form.append("file", blob, filename || "input.bin");

  const controller = new AbortController();
  const parent = signal;
  const onAbort = () => controller.abort();
  parent?.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${RUNNINGHUB_BASE_URL[site]}/task/openapi/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: form,
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || Number(result?.code) !== 0) throw new Error(cleanText(result?.msg || `上传失败（HTTP ${response.status}）`));
    const fileName = cleanText(result?.data?.fileName, 1000);
    if (!fileName) throw new Error("RunningHub 上传成功但没有返回 fileName");
    return fileName;
  } finally {
    window.clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}

export async function blobFromCanvasNode(node: CanvasNodeData, signal?: AbortSignal) {
  const content = typeof node.metadata?.content === "string" ? node.metadata.content : "";
  if (!content) throw new Error(`上游节点“${node.title}”没有可用内容`);
  const response = await fetch(content, { signal });
  if (!response.ok) throw new Error(`无法读取上游节点“${node.title}”的媒体内容`);
  return response.blob();
}

export function canvasNodeResourceKind(node: CanvasNodeData): "image" | "video" | "audio" | "text" | null {
  if (node.type === "image") return "image";
  if (node.type === "video") return "video";
  if (node.type === "audio") return "audio";
  if (node.type === "text") return "text";
  const content = typeof node.metadata?.content === "string" ? node.metadata.content : "";
  if (!content) return null;
  if (content.startsWith("data:image/")) return "image";
  if (content.startsWith("data:video/")) return "video";
  if (content.startsWith("data:audio/")) return "audio";
  const outputKind = node.metadata?.rhOutputKind;
  return outputKind === "image" || outputKind === "video" || outputKind === "audio" || outputKind === "text" ? outputKind : "text";
}

export async function startRunningHubTask(
  site: RunningHubSite,
  apiKey: string,
  webAppId: string,
  nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: unknown; description?: string }>,
  signal?: AbortSignal,
) {
  const result = requireSuccess(await fetchJson(`${RUNNINGHUB_BASE_URL[site]}/task/openapi/ai-app/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webappId: safeId(webAppId, "应用 ID"),
      apiKey: apiKey.trim(),
      nodeInfoList,
    }),
    signal,
  }, 60_000));
  const taskId = safeId(result?.data?.taskId, "任务 ID");
  return { taskId, status: cleanText(result?.data?.taskStatus || "QUEUED", 40).toUpperCase() };
}

function normalizeOutputs(raw: unknown): RunningHubOutput[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((item: any) => {
    if (typeof item === "string") {
      return /^https?:\/\//i.test(item) ? { url: item, raw: item } : { text: item, raw: item };
    }
    const url = cleanText(item?.fileUrl || item?.fileURL || item?.url || item?.downloadUrl || item?.download_url, 3000);
    const text = typeof item?.text === "string" ? item.text : typeof item?.content === "string" ? item.content : "";
    const fileType = cleanText(item?.fileType || item?.type || item?.outputType, 80);
    return { ...(url ? { url } : {}), ...(text ? { text } : {}), ...(fileType ? { fileType } : {}), raw: item };
  });
}

export async function queryRunningHubTask(site: RunningHubSite, apiKey: string, taskId: string, signal?: AbortSignal): Promise<RunningHubTaskState> {
  const result = await fetchJson(`${RUNNINGHUB_BASE_URL[site]}/task/openapi/outputs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ apiKey: apiKey.trim(), taskId: safeId(taskId, "任务 ID") }),
    signal,
  }, 60_000);
  const code = result?.code === undefined ? 0 : Number(result.code);
  const data = result?.data;
  const status = cleanText(data?.taskStatus || data?.status || result?.taskStatus || result?.status || "", 40).toUpperCase();
  if (code === 804) return { state: "pending", status: "RUNNING", outputs: [] };
  if (code === 805 || ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status) || data?.failedReason) {
    return {
      state: "failed",
      status: status || "FAILED",
      outputs: [],
      reason: cleanText(data?.failedReason || data?.errorMessage || result?.msg || "RunningHub 工作流执行失败", 500),
    };
  }
  if (code !== 0) throw new Error(cleanText(result?.msg || `RunningHub 错误 ${code}`));
  if (Array.isArray(data)) return { state: "success", status: "SUCCESS", outputs: normalizeOutputs(data) };
  if (["SUCCESS", "COMPLETED"].includes(status)) return { state: "success", status, outputs: normalizeOutputs(data?.outputs || data?.results) };
  return { state: "pending", status: status || (data?.netWssUrl ? "RUNNING" : "QUEUED"), outputs: [] };
}

export async function pollRunningHubTask(
  site: RunningHubSite,
  apiKey: string,
  taskId: string,
  onUpdate: (state: RunningHubTaskState) => void,
  signal?: AbortSignal,
) {
  const startedAt = Date.now();
  while (!signal?.aborted) {
    const state = await queryRunningHubTask(site, apiKey, taskId, signal);
    onUpdate(state);
    if (state.state !== "pending") return state;
    if (Date.now() - startedAt > 30 * 60_000) throw new Error("RunningHub 任务查询超过 30 分钟，任务可能仍在云端继续运行");
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 3000);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new DOMException("Aborted", "AbortError");
}

export function outputKind(output: RunningHubOutput): "image" | "video" | "audio" | "text" {
  const text = `${output.fileType || ""} ${output.url || ""}`.toLowerCase();
  if (/\.(mp4|webm|mov|mkv)(?:$|\?)/.test(text) || /video/.test(text)) return "video";
  if (/\.(mp3|wav|m4a|aac|flac|ogg)(?:$|\?)/.test(text) || /audio|sound/.test(text)) return "audio";
  if (/\.(png|jpe?g|webp|gif|bmp|avif)(?:$|\?)/.test(text) || /image|picture|photo/.test(text)) return "image";
  return output.url ? "image" : "text";
}

export function nodeResourceForRunningHub(node: CanvasNodeData): CanvasNodeResource | null {
  const content = typeof node.metadata?.content === "string" ? node.metadata.content : "";
  if (!content) return null;
  const kind = node.metadata?.rhOutputKind;
  if (kind === "image" || kind === "video" || kind === "audio") return { kind, url: content };
  return { kind: "text", text: content };
}
