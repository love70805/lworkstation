import http from "node:http";
import { createRequire } from "node:module";

// Dependencies live with the frontend workspace package while this entrypoint
// intentionally stays at repository level for deployment scripts.
const requireFrontendDependency = createRequire(new URL("../frontend/package.json", import.meta.url));
const { Pool } = requireFrontendDependency("pg");
const { createRemoteJWKSet, jwtVerify } = requireFrontendDependency("jose");
import {
  createClaimsAuthorizer,
  createPostgresMembershipResolver,
  createTokenActorResolver,
} from "../frontend/src/domain/cloudJwtAuthorization.js";
import {
  createPostgresSyncRuntime,
  executeSyncServiceRequest,
} from "../frontend/src/domain/syncServiceRuntime.js";
import { postgresRecoveryRepository } from "../frontend/src/domain/syncPostgresRecovery.js";
import { postgresSeedRepository } from "../frontend/src/domain/syncPostgresSeed.js";
import { extractBearerToken } from "../frontend/src/domain/cloudJwtAuthorization.js";

const port = Number(process.env.SHOPEERS_SYNC_PORT || 8787);
const databaseUrl = String(process.env.SHOPEERS_DATABASE_URL || "").trim();
const jwksUrl = String(process.env.SHOPEERS_JWKS_URL || "").trim();
const jwtIssuer = String(process.env.SHOPEERS_JWT_ISSUER || "").trim();
const jwtAudience = String(process.env.SHOPEERS_JWT_AUDIENCE || "authenticated").trim();
const corsOrigins = new Set(String(process.env.SHOPEERS_SYNC_CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
const maxEventBytes = 2 * 1024 * 1024;
const maxSeedBytes = 25 * 1024 * 1024;

function printHelp() {
  console.log(`Shopeers PostgreSQL sync server\n\nRequired environment:\n  SHOPEERS_DATABASE_URL       PostgreSQL connection string\n  SHOPEERS_JWKS_URL           JWT JWKS endpoint\n  SHOPEERS_JWT_ISSUER         JWT issuer\n  SHOPEERS_JWT_AUDIENCE       JWT audience (default: authenticated)\n  SHOPEERS_SYNC_CORS_ORIGINS  comma-separated allowed browser origins\n\nOptional:\n  SHOPEERS_SYNC_PORT=8787\n  SHOPEERS_DATABASE_SSL=require\n  SHOPEERS_DB_POOL_MAX=10`);
}

function required(value, name) {
  if (!value) throw new Error(`${name} 未配置。`);
  return value;
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("请求体超过允许大小。"), { code: "PAYLOAD_TOO_LARGE", status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function responseOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  return corsOrigins.has(requestOrigin) ? requestOrigin : null;
}

function sendJson(res, status, payload, requestOrigin = null) {
  const allowedOrigin = responseOrigin(requestOrigin);
  if (requestOrigin && !allowedOrigin) {
    res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "CORS_FORBIDDEN", message: "当前浏览器来源未被允许。", retryable: false } }));
    return;
  }
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-headers": "authorization, content-type, x-request-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  if (allowedOrigin) {
    headers["access-control-allow-origin"] = allowedOrigin;
    headers.vary = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function buildRuntime() {
  required(databaseUrl, "SHOPEERS_DATABASE_URL");
  required(jwksUrl, "SHOPEERS_JWKS_URL");
  required(jwtIssuer, "SHOPEERS_JWT_ISSUER");
  if (process.env.NODE_ENV === "production" && corsOrigins.size === 0) {
    throw new Error("生产环境必须配置 SHOPEERS_SYNC_CORS_ORIGINS。 ");
  }

  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  const verifyToken = async (token) => {
    const result = await jwtVerify(token, jwks, { issuer: jwtIssuer, audience: jwtAudience });
    return result.payload;
  };
  const resolveActor = createTokenActorResolver({ verifyToken });
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.SHOPEERS_DB_POOL_MAX || 10),
    ssl: String(process.env.SHOPEERS_DATABASE_SSL || "").toLowerCase() === "require" ? { rejectUnauthorized: false } : undefined,
  });
  const resolveMembership = createPostgresMembershipResolver({ query: (text, values) => pool.query(text, values) });
  const authorize = createClaimsAuthorizer({ verifyToken, resolveMembership });
  const runtime = createPostgresSyncRuntime({
    pool,
    authorize,
    recoveryRepository: postgresRecoveryRepository,
    seedRepository: postgresSeedRepository,
  });
  return { runtime, pool, resolveActor };
}

if (process.argv.includes("--help")) {
  printHelp();
} else {
  let serverHandle;
  try {
    const { runtime, pool, resolveActor } = buildRuntime();
    const server = http.createServer(async (req, res) => {
      const origin = String(req.headers.origin || "");
      if (origin && !corsOrigins.has(origin)) {
        sendJson(res, 403, null, origin);
        return;
      }
      if (req.method === "OPTIONS") {
        sendJson(res, 204, null, origin);
        return;
      }
      const path = String(req.url || "").split("?", 1)[0];
      const isSeedRoute = path.startsWith("/sync/v1/cloud-seeds/");
      const isPostRoute = req.method === "POST" && [
        "/sync/v1/audit-events",
        "/sync/v1/cloud-seeds/preflight",
        "/sync/v1/cloud-seeds/import",
      ].includes(path);
      try {
        const body = isPostRoute ? JSON.parse(await readBody(req, isSeedRoute ? maxSeedBytes : maxEventBytes)) : null;
        const token = extractBearerToken(req.headers);
        let actor = null;
        if (token) {
          try { actor = await resolveActor(token); } catch { actor = null; }
        }
        const workspaceId = body?.workspaceId
          ?? body?.seed?.workspaceId
          ?? (path.startsWith("/sync/v1/workspaces/") ? decodeURIComponent(path.split("/")[4] || "") : null)
          ?? null;
        const membership = actor && workspaceId
          ? await (async () => {
            try { return await resolveMembership({ userId: actor, workspaceId }); } catch { return null; }
          })()
          : null;
        const result = await executeSyncServiceRequest(runtime, {
          method: req.method,
          path,
          token,
          actor,
          body,
          requestId: String(req.headers["x-request-id"] || "") || null,
          role: membership?.role ?? null,
        });
        sendJson(res, result.status, result.payload, origin);
      } catch (error) {
        const status = Number(error.status) || (error instanceof SyntaxError ? 400 : 500);
        sendJson(res, status, {
          error: {
            code: error.code || (error instanceof SyntaxError ? "INVALID_JSON" : "INTERNAL_ERROR"),
            message: error.message || "同步服务处理失败。",
            retryable: error.retryable ?? status >= 500,
            eventIds: error.eventIds || [],
            conflicts: error.conflicts || [],
          },
        }, origin);
      }
    });
    serverHandle = server;
    server.listen(port, "0.0.0.0", () => console.log(`Shopeers PostgreSQL sync server listening on port ${port}`));
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    serverHandle?.close();
    console.error(error.message);
    process.exitCode = 1;
  }
}
