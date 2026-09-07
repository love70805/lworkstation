import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EXPECTED_BETA_CONFIG,
  isPrereleaseVersion,
  writeReleaseBetaConfig,
} = require("./release-after-pack.cjs");

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lworkstation-release-after-pack-"));
const configRoot = path.join(fixture, "config");
const appOutDir = path.join(fixture, "win-unpacked");
const resourcesDir = path.join(appOutDir, "resources");
const target = path.join(resourcesDir, "update-config.json");
fs.mkdirSync(configRoot, { recursive: true });
fs.mkdirSync(resourcesDir, { recursive: true });
fs.writeFileSync(path.join(configRoot, "update-beta-config.json"), `${JSON.stringify(EXPECTED_BETA_CONFIG, null, 2)}\n`, "utf8");
fs.writeFileSync(target, "{\n  \"enabled\": false\n}\n", "utf8");

const result = writeReleaseBetaConfig({
  appOutDir,
  packager: { appInfo: { version: "0.2.6-beta.6" } },
}, { root: configRoot });
assert.equal(result.target, target);
assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), EXPECTED_BETA_CONFIG);
assert.equal(isPrereleaseVersion("0.2.6-beta.6"), true);
assert.equal(isPrereleaseVersion("0.2.6"), false);

fs.writeFileSync(target, "{\n  \"enabled\": false\n}\n", "utf8");
assert.throws(() => writeReleaseBetaConfig({
  appOutDir,
  packager: { appInfo: { version: "0.2.6" } },
}, { root: configRoot }), /non-prerelease/);
assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).enabled, false);

fs.writeFileSync(path.join(configRoot, "update-beta-config.json"), "{\"enabled\":true,\"token\":\"not-allowed\"}", "utf8");
assert.throws(() => writeReleaseBetaConfig({
  appOutDir,
  packager: { appInfo: { version: "0.2.6-beta.6" } },
}, { root: configRoot }), /extra fields|credentials/);

fs.rmSync(fixture, { recursive: true, force: true });
console.log("desktop release after-pack tests passed");
