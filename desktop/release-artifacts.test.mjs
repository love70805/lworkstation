import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { organizeReleaseArtifacts, validateLatestArtifacts } from "./release-artifacts.mjs";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lworkstation-release-test-"));
const buildRoot = path.join(fixture, "build");
const latestRoot = path.join(fixture, "releases", "latest");
const historyRoot = path.join(fixture, "releases", "history");
const version = "0.2.6-beta.4";
const metadataFile = "beta.yml";
const oldArtifact = `Shopeers 工作站 Setup ${version}.exe`;
const artifactName = `Lworkstation-Setup-${version}.exe`;

try {
  fs.mkdirSync(buildRoot, { recursive: true });
  fs.mkdirSync(latestRoot, { recursive: true });
  fs.mkdirSync(path.join(historyRoot, version), { recursive: true });
  fs.writeFileSync(path.join(latestRoot, oldArtifact), "old-installer");
  fs.writeFileSync(path.join(latestRoot, `${oldArtifact}.blockmap`), "old-blockmap");
  fs.writeFileSync(path.join(latestRoot, metadataFile), `version: ${version}\npath: ${oldArtifact}\n`);
  fs.writeFileSync(path.join(latestRoot, "SHA256.txt"), "old hash\n");
  fs.writeFileSync(path.join(historyRoot, version, "sentinel.txt"), "preserve me");
  fs.writeFileSync(path.join(historyRoot, version, oldArtifact), "existing-history-installer");
  fs.writeFileSync(path.join(buildRoot, artifactName), "new-installer");
  fs.writeFileSync(path.join(buildRoot, `${artifactName}.blockmap`), "new-blockmap");
  fs.writeFileSync(path.join(buildRoot, metadataFile), `version: ${version}\npath: ${artifactName}\nfiles:\n  - url: ${artifactName}\n`);

  organizeReleaseArtifacts({ buildRoot, latestRoot, historyRoot, artifactName, version, metadataFile });
  assert.deepEqual(fs.readdirSync(latestRoot).sort(), ["SHA256.txt", artifactName, `${artifactName}.blockmap`, metadataFile].sort());
  assert.equal(fs.readFileSync(path.join(latestRoot, artifactName), "utf8"), "new-installer");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, "sentinel.txt"), "utf8"), "preserve me");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, oldArtifact), "utf8"), "existing-history-installer");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, `Shopeers 工作站 Setup ${version} (1).exe`), "utf8"), "old-installer");
  assert.equal(fs.readFileSync(path.join(historyRoot, version, `${oldArtifact}.blockmap`), "utf8"), "old-blockmap");
  validateLatestArtifacts({ latestRoot, artifactName, version, metadataFile });

  const extraArtifact = path.join(latestRoot, oldArtifact);
  fs.writeFileSync(extraArtifact, "unexpected");
  assert.throws(() => validateLatestArtifacts({ latestRoot, artifactName, version, metadataFile }), /unexpected release artifact/);
  fs.rmSync(extraArtifact);
  fs.writeFileSync(path.join(latestRoot, metadataFile), `version: ${version}\npath: ${oldArtifact}\n`);
  assert.throws(() => validateLatestArtifacts({ latestRoot, artifactName, version, metadataFile }), /non-current installer/);
  const rcVersion = "0.3.0-rc.1";
  const rcArtifact = `Lworkstation-Setup-${rcVersion}.exe`;
  const rcRoot = path.join(fixture, "releases", "candidates", rcVersion);
  const rcBytes = Buffer.from("isolated-rc-installer");
  const sha512 = crypto.createHash("sha512").update(rcBytes).digest("base64");
  fs.writeFileSync(path.join(buildRoot, rcArtifact), rcBytes);
  fs.writeFileSync(path.join(buildRoot, `${rcArtifact}.blockmap`), "isolated-rc-blockmap");
  const rcMetadata = `version: ${rcVersion}\nfiles:\n  - url: ${rcArtifact}\n    size: ${rcBytes.length}\n    sha512: ${sha512}\npath: ${rcArtifact}\nsha512: ${sha512}\n`;
  fs.writeFileSync(path.join(buildRoot, "rc.yml"), rcMetadata);
  organizeReleaseArtifacts({ buildRoot, latestRoot: rcRoot, historyRoot, artifactName: rcArtifact, version: rcVersion, metadataFile: "rc.yml" });
  validateLatestArtifacts({ latestRoot: rcRoot, artifactName: rcArtifact, version: rcVersion, metadataFile: "rc.yml" });
  for (const invalid of [rcMetadata.replace(`size: ${rcBytes.length}`, "size: 1"), rcMetadata.replaceAll(sha512, "incorrect")]) {
    fs.writeFileSync(path.join(rcRoot, "rc.yml"), invalid);
    assert.throws(() => validateLatestArtifacts({ latestRoot: rcRoot, artifactName: rcArtifact, version: rcVersion, metadataFile: "rc.yml" }), /SHA512\/size/);
  }
  console.log("release artifact fixtures passed");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
