import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const toolsRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = join(toolsRoot, "..");
const frontendRoot = join(workspaceRoot, "frontend");
const execFile = promisify(execFileCallback);

const requiredFiles = [
  join(frontendRoot, "package.json"),
  join(frontendRoot, ".env.example"),
  join(frontendRoot, "vercel.json"),
  join(frontendRoot, "supabase", "migrations", "0001_shopeers_core.sql"),
  join(frontendRoot, "docs", "DEPLOYMENT_GUIDE.md"),
  join(workspaceRoot, "docs", "CLOUD_UPLOAD_GUIDE.md"),
  join(workspaceRoot, "tools", "sync-production-server.mjs"),
  join(workspaceRoot, "tools", "build-erpa-shopeers-bridge.mjs"),
  join(workspaceRoot, "tools", "cloud-preflight.mjs"),
  join(workspaceRoot, ".github", "workflows", "quality.yml"),
  join(workspaceRoot, ".github", "workflows", "deploy-cloud.yml"),
  join(workspaceRoot, "render.yaml"),
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runNode(args, env = process.env) {
  try {
    const result = await execFile(process.execPath, args, {
      cwd: frontendRoot,
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: Number(error.code) || 1,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

async function main() {
  const missing = (await Promise.all(requiredFiles.map(async (path) => (await exists(path) ? null : path)))).filter(Boolean);
  if (missing.length > 0) {
    console.error(JSON.stringify({ status: "invalid", code: "MISSING_DEPLOYMENT_FILES", missing }, null, 2));
    process.exitCode = 1;
    return;
  }

  const [packageText, envText, vercelText, runtimeText, guideText, serverText, workflowText, deployWorkflowText, renderText] = await Promise.all([
    readFile(join(frontendRoot, "package.json"), "utf8"),
    readFile(join(frontendRoot, ".env.example"), "utf8"),
    readFile(join(frontendRoot, "vercel.json"), "utf8"),
    readFile(join(frontendRoot, "src", "config", "runtimeConfig.js"), "utf8"),
    readFile(join(frontendRoot, "docs", "DEPLOYMENT_GUIDE.md"), "utf8"),
    readFile(join(workspaceRoot, "tools", "sync-production-server.mjs"), "utf8"),
    readFile(join(workspaceRoot, ".github", "workflows", "quality.yml"), "utf8"),
    readFile(join(workspaceRoot, ".github", "workflows", "deploy-cloud.yml"), "utf8"),
    readFile(join(workspaceRoot, "render.yaml"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const requiredScripts = ["test", "build", "erp:bridge:test", "sync:check", "sync:postgres", "seed:check", "schema:check", "deploy:check", "cloud:check"];
  const missingScripts = requiredScripts.filter((script) => !packageJson.scripts?.[script]);
  const unsafeEnvKeys = envText.split(/\r?\n/).filter((line) => /^VITE_.*(PASSWORD|SECRET|SERVICE_ROLE|TOKEN|COOKIE|DATABASE_URL)/i.test(line));
  const vercel = JSON.parse(vercelText);
  const helpResult = await runNode([join(workspaceRoot, "tools", "sync-production-server.mjs"), "--help"]);
  const missingConfigResult = await runNode([join(workspaceRoot, "tools", "sync-production-server.mjs")], {
    ...process.env,
    NODE_ENV: "production",
    SHOPEERS_DATABASE_URL: "",
    SHOPEERS_JWKS_URL: "",
    SHOPEERS_JWT_ISSUER: "",
    SHOPEERS_SYNC_CORS_ORIGINS: "",
  });
  const checks = {
    requiredFiles: true,
    requiredScripts: missingScripts.length === 0,
    localDefault: /VITE_SYNC_PROVIDER=local/.test(envText),
    supabaseUsesSeparateSyncEndpoint: /VITE_SYNC_API_BASE_URL/.test(envText) && /VITE_SYNC_API_BASE_URL/.test(guideText),
    spaRewrite: Array.isArray(vercel.rewrites) && vercel.rewrites.some((item) => item.destination === "/index.html"),
    runtimeSeparatesSyncEndpoint: /syncApiBaseUrl/.test(runtimeText),
    postgresServerPresent: /createPostgresSyncRuntime/.test(serverText),
    postgresDependencyBridge: /createRequire/.test(serverText) && helpResult.code === 0 && /PostgreSQL sync server/.test(helpResult.stdout),
    productionConfigFailClosed: missingConfigResult.code !== 0 && /SHOPEERS_DATABASE_URL/.test(missingConfigResult.stderr),
    noUnsafeViteSecrets: unsafeEnvKeys.length === 0,
    githubQualityWorkflow: /pnpm release:check/.test(workflowText) && /pull_request:/.test(workflowText),
    githubCloudWorkflowManualOnly: /workflow_dispatch:/.test(deployWorkflowText) && !/\n\s*push:/.test(deployWorkflowText),
    githubCloudWorkflowProviderAware: /VITE_SYNC_PROVIDER.*api.*supabase/s.test(deployWorkflowText)
      && /Supabase 模式缺少/.test(deployWorkflowText)
      && /VITE_SYNC_API_BASE_URL/.test(deployWorkflowText),
    githubCloudWorkflowEndpointFallback: /SYNC_ENDPOINT=/.test(deployWorkflowText)
      && /VITE_API_BASE_URL/.test(deployWorkflowText),
    renderSyncBlueprint: /dockerfilePath:\s*\.\/Dockerfile\.sync/.test(renderText) && /healthCheckPath:\s*\/health/.test(renderText),
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const result = { status: failed.length === 0 ? "ok" : "invalid", checks, missingScripts, unsafeEnvKeys };
  console.log(JSON.stringify(result, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
