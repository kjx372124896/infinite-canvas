import { timingSafeEqual } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";

import { loadConfig, type CanvasAgentConfig } from "../config.js";
import { createCanvasMcpServer } from "./mcp.js";

const DEFAULT_REMOTE_MCP_PORT = 17372;
const DEFAULT_REMOTE_MCP_PATH = "/mcp";

/**
 * 启动供 ChatGPT / 远程 MCP 客户端使用的 Streamable HTTP MCP。
 *
 * 该服务与现有 Canvas Agent HTTP/Codex 链路完全独立，只把 MCP 请求转发到
 * 已有 Canvas Agent /api/tools。默认仅监听 127.0.0.1，适合配合 Secure MCP Tunnel。
 */
export async function startRemoteMcpServer() {
    const config = loadConfig(true);
    const host = process.env.CANVAS_MCP_HOST?.trim() || "127.0.0.1";
    const port = positivePort(process.env.CANVAS_MCP_PORT) || DEFAULT_REMOTE_MCP_PORT;
    const endpointPath = normalizePath(process.env.CANVAS_MCP_PATH || DEFAULT_REMOTE_MCP_PATH);
    const token = process.env.CANVAS_MCP_TOKEN?.trim() || config.token;
    const app = createRemoteMcpApp(config, token, host, endpointPath);

    app.listen(port, host, (error?: Error) => {
        if (error) {
            console.error("Failed to start Infinite Canvas Remote MCP:", error);
            process.exitCode = 1;
            return;
        }
        const localUrl = `http://${displayHost(host)}:${port}${endpointPath}`;
        console.log("Infinite Canvas Remote MCP");
        console.log(`Local MCP URL: ${localUrl}`);
        console.log(`Canvas Agent backend: ${config.url}`);
        console.log("Auth: Bearer token, x-canvas-agent-token, or ?token=... (reuses the Canvas Agent connect token by default)");
        console.log(`Secure MCP Tunnel target: ${localUrl}?token=${encodeURIComponent(token)}`);
        console.log("This command does not modify or replace the existing Codex app-server / stdio MCP flow.");
    });
}

/** 构造可测试、可嵌入的 Remote MCP Express 应用。 */
export function createRemoteMcpApp(config: CanvasAgentConfig, token: string, host = "127.0.0.1", endpointPath = DEFAULT_REMOTE_MCP_PATH) {
    const app = createMcpExpressApp({ host });

    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            service: "infinite-canvas-remote-mcp",
            transport: "streamable-http",
            endpoint: endpointPath,
            canvasAgent: config.url,
        });
    });

    app.post(endpointPath, async (req, res) => {
        if (!authorized(req, token)) return unauthorized(res);

        // Each request gets an independent stateless transport. Canvas state itself remains in
        // the local Agent service, so remote clients never need access to the Agent HTTP API.
        const server = createCanvasMcpServer(config);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            res.on("close", () => {
                void transport.close();
                void server.close();
            });
        } catch (error) {
            console.error("[remote-mcp] request failed", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
                    id: null,
                });
            }
        }
    });

    app.get(endpointPath, (req, res) => {
        if (!authorized(req, token)) return unauthorized(res);
        return methodNotAllowed(res);
    });

    app.delete(endpointPath, (req, res) => {
        if (!authorized(req, token)) return unauthorized(res);
        return methodNotAllowed(res);
    });

    return app;
}

function authorized(req: Request, expected: string) {
    const authorization = req.headers.authorization || "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    const header = req.headers["x-canvas-agent-token"];
    const headerToken = Array.isArray(header) ? header[0] || "" : header || "";
    const queryToken = typeof req.query.token === "string" ? req.query.token : "";
    return [bearer, headerToken, queryToken].some((candidate) => secureEqual(candidate, expected));
}

function secureEqual(actual: string, expected: string) {
    if (!actual || !expected) return false;
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

function unauthorized(res: Response) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="Infinite Canvas Remote MCP"');
    return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
    });
}

function methodNotAllowed(res: Response) {
    return res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
    });
}

function normalizePath(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "/") return DEFAULT_REMOTE_MCP_PATH;
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function positivePort(value: string | undefined) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 0;
}

function displayHost(host: string) {
    return host === "::1" ? "[::1]" : host;
}
