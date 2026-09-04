import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  isPrereleaseVersion,
  loadReleaseBetaConfig,
} = require("./release-after-pack.cjs");

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const pkg = readJson("package.json");
const plan = readJson("release-plan.json");
const version = plan.version;
const artifactName = `Lworkstation-Setup-${version}.exe`;
const outputRoot = path.join(root, "release");
const candidateRoot = path.join(root, "release-test", version);
const betaConfig = loadReleaseBetaConfig(root);
const pnpmCli = process.env.npm_execpath;
const builderCli = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with code ${result.status}`);
}

function runPnpm(args) {
  if (pnpmCli && fs.existsSync(pnpmCli)) {
    run(process.execPath, [pnpmCli, ...args]);
    return;
  }
  run("pnpm", args);
}

function resetDirectory(target, expected) {
  const resolved = path.resolve(target);
  if (resolved !== path.resolve(expected)) throw new Error(`Refusing to clear unexpected directory: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function metadataAssetNames(contents) {
  return [...String(contents).matchAll(/^\s*(?:-\s*)?(?:path|url):\s*["']?(.+?\.exe)["']?\s*$/gm)]
    .map((match) => match[1].trim());
}

function verifyPackagedBetaConfig() {
  const configPath = path.join(outputRoot, "win-unpacked", "resources", "update-config.json");
  if (!fs.existsSync(configPath)) throw new Error(`Packaged update configuration is missing: ${configPath}`);
  const packagedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (JSON.stringify(packagedConfig) !== JSON.stringify(betaConfig)) {
    throw new Error("Release package did not receive the controlled beta update configuration.");
  }
}

function stageReleaseCandidate() {
  const installer = path.join(outputRoot, artifactName);
  const blockmap = `${installer}.blockmap`;
  const metadata = path.join(outputRoot, "beta.yml");
  for (const file of [installer, blockmap, metadata]) {
    if (!fs.existsSync(file)) throw new Error(`Release build is missing artifact: ${file}`);
  }
  if (fs.existsSync(path.join(outputRoot, "latest.yml"))) {
    throw new Error("Prerelease build unexpectedly produced latest.yml instead of beta.yml.");
  }
  const metadataContents = fs.readFileSync(metadata, "utf8");
  const names = metadataAssetNames(metadataContents);
  if (!new RegExp(`^version:\\s*${version.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "m").test(metadataContents)
    || names.length < 2
    || names.some((name) => name !== artifactName)) {
    throw new Error(`beta.yml must reference only ${artifactName}.`);
  }

  resetDirectory(candidateRoot, path.join(root, "release-test", version));
  for (const source of [installer, blockmap, metadata]) {
    fs.copyFileSync(source, path.join(candidateRoot, path.basename(source)));
  }
  return {
    installer: artifactName,
    bytes: fs.statSync(installer).size,
    sha256: sha256(installer),
    blockmapSha256: sha256(blockmap),
    metadataSha256: sha256(metadata),
  };
}

if (pkg.version !== version) throw new Error("package.json version must match release-plan.json.");
if (!isPrereleaseVersion(version)) throw new Error("release:build only supports an explicit prerelease version.");
if (!fs.existsSync(builderCli)) throw new Error(`Unable to locate Electron Builder: ${builderCli}`);

resetDirectory(outputRoot, path.join(root, "release"));
runPnpm(["--dir", "../frontend", "build"]);
runPnpm(["brand:icons"]);
run(process.execPath, [builderCli,
  "--win",
  "nsis",
  "--publish",
  "never",
  "--config.electronDist=./node_modules/electron/dist",
  "--config.afterPack=./release-after-pack.cjs",
  "--config.publish.releaseType=prerelease",
  "--config.publish.channel=beta",
  "--config.win.artifactName=Lworkstation-Setup-${version}.${ext}",
]);

verifyPackagedBetaConfig();
const candidate = stageReleaseCandidate();
console.log(JSON.stringify({ version, artifact: artifactName, candidate }, null, 2));
