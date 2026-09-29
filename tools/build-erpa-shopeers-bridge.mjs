import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceDir = path.resolve(process.argv[2] || "");
const outputDir = path.resolve(process.argv[3] || "");
if (!sourceDir || !outputDir) {
  console.error("用法：node tools/build-erpa-shopeers-bridge.mjs <v8.0扩展目录> <输出目录>");
  process.exit(2);
}

const manifestPath = path.join(outputDir, "manifest.json");
const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const canonicalExtensionDir = path.join(toolsRoot, "..", "integrations", "erp-assistant-extension");
const canonicalSourceDir = path.join(canonicalExtensionDir, "src");
const canonicalManifest = JSON.parse(await fs.readFile(path.join(canonicalExtensionDir, "manifest.json"), "utf8"));
const frontendRequire = createRequire(path.join(toolsRoot, "..", "frontend", "package.json"));
const esbuild = createRequire(frontendRequire.resolve("vite/package.json"))("esbuild");
const catalogBundle = await esbuild.build({ entryPoints: [path.join(toolsRoot, "..", "frontend", "src", "domain", "erpCatalogRequest.js")], bundle: true, absWorkingDir: path.join(toolsRoot, ".."), format: "esm", platform: "node", write: false, legalComments: "none" });
await fs.writeFile(path.join(toolsRoot, "erp-inbox-server-catalog-contract.mjs"), catalogBundle.outputFiles[0].text, "utf8");
const secureModules = [
  "background.js",
  "catalog-collector.js",
  "content.css",
  "content.js",
  "query-hook.js",
  "request-context.js",
  "result-policy.js",
  "shopeers-bridge.js",
];

await fs.cp(sourceDir, outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "src"), { recursive: true });
await Promise.all(secureModules.map((file) => fs.copyFile(
  path.join(canonicalSourceDir, file),
  path.join(outputDir, "src", file),
)));
await fs.copyFile(path.join(canonicalExtensionDir, "README.md"), path.join(outputDir, "README.md"));
await fs.rm(path.join(outputDir, "src", "inbox-config.js"), { force: true });

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.version = canonicalManifest.version;
manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), "http://127.0.0.1/*", "http://localhost/*"])];
manifest.permissions = [...new Set([...(manifest.permissions || []), "alarms", "storage"])];
manifest.background = { service_worker: "src/background.js" };
manifest.content_scripts = canonicalManifest.content_scripts;
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ status: "ok", sourceDir, outputDir, manifestPath, secureModules }));
