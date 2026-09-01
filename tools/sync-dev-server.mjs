import http from "node:http";
import { createCloudAuthorizer } from "../frontend/src/domain/cloudAuthorization.js";
import { createMemorySyncRuntime, executeSyncServiceRequest } from "../frontend/src/domain/syncServiceRuntime.js";

const port = Number(process.env.SHOPEERS_SYNC_PORT || 8787);
const expectedToken = String(process.env.SHOPEERS_SYNC_TOKEN || "").trim();
const role = String(process.env.SHOPEERS_SYNC_ROLE || "admin").trim().toLowerCase();
const allowedWorkspaces = String(process.env.SHOPEERS_SYNC_WORKSPACES || "").split(",").map((value) => value.trim()).filter(Boolean);
const authorize = createCloudAuthorizer({ expectedToken, role, allowedWorkspaces });
const runtime = createMemorySyncRuntime({ authorize });

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("请求体过大。"), { code: "PAYLOAD_TOO_LARGE", status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, null);
    return;
  }
  const supportedPostRoute = req.method === "POST" && [
    "/sync/v1/audit-events",
    "/sync/v1/cloud-seeds/preflight",
    "/sync/v1/cloud-seeds/import",
  ].includes(req.url);
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  try {
    let payload = null;
    if (supportedPostRoute) {
      const source = await readBody(req, req.url.startsWith("/sync/v1/cloud-seeds/") ? 25 * 1024 * 1024 : undefined);
      payload = JSON.parse(source);
    }
    const result = await executeSyncServiceRequest(runtime, {
      method: req.method,
      path: req.url,
      token,
      body: payload,
      requestId: String(req.headers["x-request-id"] || "") || null,
    });
    json(res, result.status, result.payload);
  } catch (error) {
    const status = Number(error.status) || (error instanceof SyntaxError ? 400 : 500);
    json(res, status, {
      error: {
        code: error.code || (error instanceof SyntaxError ? "INVALID_JSON" : "INTERNAL_ERROR"),
        message: error.message || "同步失败。",
        retryable: error.retryable ?? status >= 500,
        eventIds: error.eventIds || [],
        conflicts: error.conflicts || [],
      },
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Shopeers sync dev server listening on http://127.0.0.1:${port}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
