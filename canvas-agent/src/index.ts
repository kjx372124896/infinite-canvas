#!/usr/bin/env node
import { startHttpServer } from "./server/http.js";
import { startRemoteMcpServer } from "./server/mcp-http.js";
import { startMcpServer } from "./server/mcp.js";

if (process.argv[2] === "mcp") await startMcpServer();
else if (process.argv[2] === "remote" || process.argv[2] === "mcp-http") await startRemoteMcpServer();
else startHttpServer();
