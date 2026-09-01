import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { loadUpdateFixtureConfig, metadataAssetNames } = require("./update-fixture-config.cjs");
const testConfig = loadUpdateFixtureConfig(root);
const outputRoot = path.join(root, "release-test");
const pnpmCli = process.env.npm_execpath;
const builderCli = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with code ${result.status}`);
}

function safeRemove(target) {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(root) || path.basename(resolved) !== "release-test") {
    throw new Error(`拒绝清理非测试更新产物目录：${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function verifyFixture(version, artifactName) {
  const releaseRoot = path.join(outputRoot, version);
  const installer = path.join(releaseRoot, artifactName);
  const blockmap = `${installer}.blockmap`;
  const metadata = path.join(releaseRoot, testConfig.metadataFile);
  const updateConfig = path.join(releaseRoot, "win-unpacked", "resources", "update-config.json");
  for (const file of [installer, blockmap, metadata, updateConfig]) {
    if (!fs.existsSync(file)) throw new Error(`测试更新夹具缺少产物：${file}`);
  }
  const packagedConfig = JSON.parse(fs.readFileSync(updateConfig, "utf8"));
  if (JSON.stringify(packagedConfig) !== JSON.stringify(testConfig.betaConfig)) {
    throw new Error(`${version} 未打入受控 beta 更新配置`);
  }
  const metadataContents = fs.readFileSync(metadata, "utf8");
  const assets = metadataAssetNames(metadataContents);
  if (!metadataContents.includes(`version: ${version}`)
    || assets.length < 2
    || assets.some((name) => name !== artifactName)) {
    throw new Error(`${testConfig.metadataFile} 未严格指向 ${artifactName}`);
  }
  const hashes = [installer, blockmap, metadata].map((file) => `${sha256(file)}  ${path.basename(file)}`);
  const sha256Path = path.join(releaseRoot, "SHA256.txt");
  fs.writeFileSync(sha256Path, `${hashes.join("\n")}\n`, "utf8");
  return {
    version,
    installer,
    blockmap,
    metadata,
    sha256Path,
    installerSize: fs.statSync(installer).size,
    installerSha256: sha256(installer),
    blockmapSize: fs.statSync(blockmap).size,
    blockmapSha256: sha256(blockmap),
    metadataSha256: sha256(metadata),
  };
}

safeRemove(outputRoot);
if (!pnpmCli || !fs.existsSync(pnpmCli)) throw new Error("无法定位当前 pnpm CLI。");
run(process.execPath, [pnpmCli, "--dir", "../frontend", "build"]);
run(process.execPath, [pnpmCli, "brand:icons"]);

const common = [
  "--win",
  "nsis",
  "--config.electronDist=./node_modules/electron/dist",
  "--config.afterPack=./update-fixture-after-pack.cjs",
  `--config.publish.releaseType=${testConfig.releaseType}`,
  `--config.publish.channel=${testConfig.channel}`,
  `--config.win.artifactName=${testConfig.artifactPattern}`,
];
for (const version of [testConfig.sourceVersion, testConfig.targetVersion]) {
  run(process.execPath, [builderCli,
    ...common,
    `--config.extraMetadata.version=${version}`,
    `--config.directories.output=release-test/${version}`,
  ]);
}

const source = verifyFixture(testConfig.sourceVersion, testConfig.sourceArtifactName);
const target = verifyFixture(testConfig.targetVersion, testConfig.targetArtifactName);
console.log(JSON.stringify({
  purpose: testConfig.purpose,
  channel: testConfig.channel,
  repository: testConfig.repository,
  source,
  target,
}, null, 2));
