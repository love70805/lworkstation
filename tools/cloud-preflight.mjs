import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const toolsRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = join(toolsRoot, "..");
const frontendRoot = join(workspaceRoot, "frontend");
const provider = String(process.env.VITE_SYNC_PROVIDER || "local").trim().toLowerCase() || "local";
const strict = String(process.env.CLOUD_PREFLIGHT_STRICT || "").trim().toLowerCase() === "true"
  || process.argv.includes("--strict");
const ping = String(process.env.CLOUD_PREFLIGHT_PING || "").trim().toLowerCase() === "true"
  || process.argv.includes("--ping");
const validProviders = new Set(["local", "api", "supabase"]);

const requiredFiles = [
  join(frontendRoot, "package.json"),
  join(frontendRoot, "vercel.json"),
  join(frontendRoot, "supabase", "migrations", "0001_shopeers_core.sql"),
  join(workspaceRoot, "Dockerfile.sync"),
  join(workspaceRoot, ".github", "workflows", "quality.yml"),
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function endpointForConfig() {
  return clean(process.env.VITE_SYNC_API_BASE_URL) || clean(process.env.VITE_API_BASE_URL);
}

function providerRequirements() {
  if (provider === "local") return [];
  if (provider === "api") return ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
  if (provider === "supabase") return ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SYNC_API_BASE_URL"];
  return ["VITE_SYNC_PROVIDER"];
}

async function checkHealth(endpoint) {
  if (!ping) return { status: "skipped", reason: "CLOUD_PREFLIGHT_PING 未启用" };
  if (!endpoint) return { status: "missing", reason: "同步端点未配置" };
  if (typeof fetch !== "function") return { status: "unavailable", reason: "当前 Node.js 不支持 fetch" };
  const url = `${endpoint.replace(/\/$/, "")}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok || body?.status !== "ok") {
      return { status: "failed", url, httpStatus: response.status, serviceStatus: body?.status ?? null };
    }
    return { status: "ok", url, backend: body.backend ?? null };
  } catch (error) {
    return { status: "failed", url, reason: error.name === "AbortError" ? "请求超时" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const missingFiles = (await Promise.all(requiredFiles.map(async (path) => (await exists(path) ? null : path)))).filter(Boolean);
  const providerValid = validProviders.has(provider);
  const requiredEnv = providerRequirements();
  const endpoint = endpointForConfig();
  const missingEnv = requiredEnv.filter((key) => !clean(process.env[key]));
  if (provider === "api" && !endpoint) missingEnv.push("VITE_API_BASE_URL or VITE_SYNC_API_BASE_URL");
  const staticCheck = { status: missingFiles.length === 0 ? "ok" : "failed", missingFiles };
  const configCheck = !providerValid
    ? { status: "failed", provider, requiredEnv, missingEnv }
    : { status: missingEnv.length === 0 ? "ok" : "warning", provider, requiredEnv, missingEnv };
  const health = await checkHealth(endpoint);
  const blocking = missingFiles.length > 0
    || !providerValid
    || (strict && missingEnv.length > 0)
    || (strict && ping && health.status !== "ok");
  const status = blocking ? "blocked" : missingEnv.length > 0 || ["failed", "missing", "unavailable"].includes(health.status) ? "warning" : "ready";
  const result = {
    status,
    mode: strict ? "strict" : "advisory",
    provider,
    checks: { static: staticCheck, config: configCheck, health },
    guidance: status === "ready"
      ? ["可继续执行部署前的数据库迁移、登录和权限验收。"]
      : provider === "local"
        ? ["本机模式可直接开发；切换云端前请配置 Supabase 或独立同步 API。"]
        : ["补齐云端变量后重新执行 cloud:check --strict --ping。"],
  };
  console.log(JSON.stringify(result, null, 2));
  if (blocking) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
