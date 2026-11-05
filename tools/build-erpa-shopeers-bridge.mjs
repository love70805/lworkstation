import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (!process.argv[2]?.trim() || !process.argv[3]?.trim()) {
  console.error("用法：node tools/build-erpa-shopeers-bridge.mjs <v8.0扩展目录> <输出目录>");
  process.exit(2);
}
const sourceDir = path.resolve(process.argv[2]);
const outputDir = path.resolve(process.argv[3]);
const relativeOutput = path.relative(sourceDir, outputDir);
if (!relativeOutput || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput))) {
  throw new Error('输出目录不能等于或位于来源目录内。');
}

const manifestPath = path.join(outputDir, "manifest.json");
const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const canonicalExtensionDir = path.join(toolsRoot, "..", "integrations", "erp-assistant-extension");
const canonicalSourceDir = path.join(canonicalExtensionDir, "src");
const canonicalManifest = JSON.parse(await fs.readFile(path.join(canonicalExtensionDir, "manifest.json"), "utf8"));
const frontendRequire = createRequire(path.join(toolsRoot, "..", "frontend", "package.json"));
const xlsxRoot = path.dirname(frontendRequire.resolve('xlsx'));
const xlsxPackage = JSON.parse(await fs.readFile(path.join(xlsxRoot, 'package.json'), 'utf8'));
if (xlsxPackage.version !== '0.20.3') throw new Error('Unexpected workbook parser version');
const xlsxReader = (await fs.readFile(path.join(xlsxRoot, 'dist', 'xlsx.mini.min.js'), 'utf8')).replace(/\/\/# sourceMappingURL=.*$/gm, '');
const xlsxReaderTarget = path.join(canonicalSourceDir, 'xlsx-reader.js');
if (await fs.readFile(xlsxReaderTarget, 'utf8').catch(() => '') !== xlsxReader) await fs.writeFile(xlsxReaderTarget, xlsxReader, 'utf8');
await fs.copyFile(path.join(xlsxRoot, 'LICENSE'), path.join(canonicalExtensionDir, 'LICENSE.sheetjs'));
const esbuild = createRequire(frontendRequire.resolve("vite/package.json"))("esbuild");
const archiveBundle = await esbuild.build({ absWorkingDir: path.join(toolsRoot, '..'), entryPoints: [path.join(toolsRoot, '..', 'frontend', 'src', 'domain', 'productArchiveWorkbook.js')], bundle: true, format: 'iife', globalName: 'ShopeersErpProductArchive', platform: 'browser', write: false, legalComments: 'none' });
await fs.writeFile(path.join(canonicalSourceDir, 'product-archive.js'), archiveBundle.outputFiles[0].text, 'utf8');
const catalogBundle = await esbuild.build({ entryPoints: [path.join(toolsRoot, "..", "frontend", "src", "domain", "erpCatalogRequest.js")], bundle: true, absWorkingDir: path.join(toolsRoot, ".."), format: "esm", platform: "node", write: false, legalComments: "none" });
const contractPath=path.join(toolsRoot,'erp-inbox-server-catalog-contract.mjs');
const generatedContract=catalogBundle.outputFiles[0].text;
const previousContract=await fs.readFile(contractPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(previousContract===null||previousContract.replace(/\r\n/g,'\n')!==generatedContract.replace(/\r\n/g,'\n')) {
  await fs.writeFile(contractPath,previousContract?.includes('\r\n')?generatedContract.replace(/\r?\n/g,'\r\n'):generatedContract,'utf8');
}
const secureModules = [
  "background.js",
  "xlsx-reader.js",
  "bulk-purchase.js",
  "product-archive.js",
  "catalog-collector.js",
  "content.css",
  "content.js",
  "desktop-task-preview.js",
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
await fs.copyFile(path.join(canonicalExtensionDir, 'LICENSE.sheetjs'), path.join(outputDir, 'LICENSE.sheetjs'));
await fs.rm(path.join(outputDir, "src", "inbox-config.js"), { force: true });

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.version = canonicalManifest.version;
manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), "http://127.0.0.1/*", "http://localhost/*"])];
manifest.permissions = [...new Set([...(manifest.permissions || []), "alarms", "storage"])];
manifest.background = { service_worker: "src/background.js" };
manifest.content_scripts = canonicalManifest.content_scripts;
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ status: "ok", sourceDir, outputDir, manifestPath, secureModules }));
