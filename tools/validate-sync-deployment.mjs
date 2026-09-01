import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checks = {
  dockerfile: false,
  serverEntrypoint: false,
  productionDependencies: false,
  failClosedEnv: false,
};

const dockerfile = await fs.readFile(path.join(root, "Dockerfile.sync"), "utf8");
const server = await fs.readFile(path.join(root, "tools", "sync-production-server.mjs"), "utf8");
const packageJson = JSON.parse(await fs.readFile(path.join(root, "frontend", "package.json"), "utf8"));

checks.dockerfile = /FROM node:22-bookworm-slim/.test(dockerfile)
  && /pnpm install --prod --frozen-lockfile/.test(dockerfile)
  && /sync-production-server\.mjs/.test(dockerfile);
checks.serverEntrypoint = /createPostgresSyncRuntime/.test(server)
  && /createRemoteJWKSet/.test(server)
  && /SHOPEERS_DATABASE_URL/.test(server);
checks.productionDependencies = Boolean(packageJson.dependencies?.pg && packageJson.dependencies?.jose);
checks.failClosedEnv = /required\(databaseUrl/.test(server)
  && /required\(jwksUrl/.test(server)
  && /required\(jwtIssuer/.test(server);

const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ status: ok ? "ok" : "failed", checks }, null, 2));
if (!ok) process.exitCode = 1;

