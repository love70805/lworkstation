import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { organizeReleaseArtifacts, validateLatestArtifacts } from "./release-artifacts.mjs";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lworkstation-release-test-"));
const buildRoot = path.join(fixture, "build");
const latestRoot = path.join(fixture, "releases", "latest");
const historyRoot = path.join(fixture, "releases", "history");
const version = "0.2.5";
const oldArtifact = `Shopeers 工作站 Setup ${version}.exe`;
const artifactName = `Lworkstation Setup ${version}.exe`;

try {
  fs.mkdirSync(buildRoot, { recursive: true });
  fs.mkdirSync(latestRoot, { recursive: true });
  fs.mkdirSync(path.join(historyRoot, version), { recursive: true });
  fs.writeFileSync(path.join(latestRoot, oldArtifact), "old-installer");
  fs.writeFileSync(path.join(latestRoot, `${oldArtifact}.blockmap`), "old-blockmap");
  fs.writeFileSync(path.join(latestRoot, "latest.yml"), `version: ${version}\npath: ${oldArtifact}\n`);
  fs.writeFileSync(path.join(latestRoot, "SHA256.txt"), "old hash\n");
  fs.writeFileSync(path.join(historyRoot, version, "sentinel.txt"), "preserve me");
  fs.writeFileSync(path.join(historyRoot, version, oldArtifact), "existing-history-installer");
  fs.writeFileSync(path.join(buildRoot, artifactName), "new-installer");
  fs.writeFileSync(path.join(buildRoot, `${artifactName}.blockmap`), "new-blockmap");
  fs.writeFileSync(path.join(buildRoot, "latest.yml"), `version: ${version}\npath: ${artifactName}\nfiles:\n  - url: ${artifactName}\n`);

  organizeReleaseArtifacts({ buildRoot, latestRoot, historyRoot, artifactName, version });
  assert.deepEqual(fs.readdirSync(latestRoot).sort(), ["SHA256.txt", artifactName, `${artifactName}.blockmap`, "latest.yml"].sort());
  assert.equal(fs.readFileSync(path.join(latestRoot, artifactName), "utf8"), "new-installer");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, "sentinel.txt"), "utf8"), "preserve me");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, oldArtifact), "utf8"), "existing-history-installer");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, `Shopeers 工作站 Setup ${version} (1).exe`), "utf8"), "old-installer");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, `${oldArtifact}.blockmap`), "utf8"), "old-blockmap");
  validateLatestArtifacts({ latestRoot, artifactName, version });

  const extraArtifact = path.join(latestRoot, oldArtifact);
  fs.writeFileSync(extraArtifact, "unexpected");
  assert.throws(() => validateLatestArtifacts({ latestRoot, artifactName, version }), /unexpected latest artifact/);
  fs.rmSync(extraArtifact);
  fs.writeFileSync(path.join(latestRoot, "latest.yml"), `version: ${version}\npath: ${oldArtifact}\n`);
  assert.throws(() => validateLatestArtifacts({ latestRoot, artifactName, version }), /non-current installer/);
  console.log("release artifact fixtures passed");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
