import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceDir = path.resolve(process.argv[2] || "integrations/1688-selection-extension");
const outputRoot = path.resolve(process.argv[3] || "frontend/public/integrations/1688-selection");
const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
const version = String(manifest.version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("1688 selection extension manifest version is invalid.");
const packageName = `Shopeers-1688-Capture-v${version}`;
const packageDir = path.join(outputRoot, packageName);
const zipPath = path.join(outputRoot, `${packageName}.zip`);

await fs.mkdir(outputRoot, { recursive: true });
await fs.rm(packageDir, { recursive: true, force: true });
await fs.rm(zipPath, { force: true });
await fs.cp(sourceDir, packageDir, { recursive: true, force: true });
await execFileAsync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${packageDir}', '${zipPath}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
], { windowsHide: true });
console.log(JSON.stringify({ status: "ok", packageDir, zipPath }));
