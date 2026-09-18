import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createRemoteMcpApp } from "./mcp-http.js";

test("Remote MCP requires auth and exposes Canvas tools over Streamable HTTP", async (t) => {
    const app = createRemoteMcpApp({ url: "http://127.0.0.1:9", token: "unused" }, "test-token");
    const http = app.listen(0, "127.0.0.1");
    await once(http, "listening");
    t.after(() => new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve()))));

    const port = (http.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
    };

    const unauthorized = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
        }),
    });
    assert.equal(unauthorized.status, 401);

    const initialized = await post(endpoint, headers, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    });
    assert.equal(initialized.result?.serverInfo?.name, "canvas-agent");

    const listed = await post(endpoint, headers, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = (listed.result?.tools || []).map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("canvas_get_state"));
    assert.ok(names.includes("canvas_apply_ops"));
    assert.ok(names.length > 10);
});

async function post(endpoint: string, headers: Record<string, string>, payload: unknown) {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 200);
    return (await response.json()) as { result?: Record<string, any>; error?: unknown };
}
