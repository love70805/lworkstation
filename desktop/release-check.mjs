import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { artifactNameFromPattern, validateLatestArtifacts } from "./release-artifacts.mjs";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(desktopRoot, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(desktopRoot, file), "utf8"));
const plan = readJson("release-plan.json");
const pkg = readJson("package.json");

assert.equal(pkg.version, plan.version, "desktop package version must match release-plan.json");
assert.equal(pkg.name, "shopeers-desktop", "package name must keep the existing userData identity");
assert.equal(pkg.build.appId, "com.shopeers.workstation", "Windows appId must remain stable");
assert.equal(pkg.build.productName, "Lworkstation", "visible Windows product name must be Lworkstation");
assert.equal(pkg.build.win.executableName, "Lworkstation", "packaged executable must be Lworkstation.exe");
assert.equal(pkg.build.win.artifactName, "Lworkstation Setup ${version}.${ext}");
assert.equal(pkg.build.win.icon, "assets/lworkstation.ico");
for (const key of ["installerIcon", "installerHeaderIcon", "uninstallerIcon"]) {
  assert.equal(pkg.build.nsis[key], "assets/lworkstation.ico", `${key} must use the approved L7 icon`);
}
assert.equal(pkg.build.nsis.shortcutName, "Lworkstation");
assert.equal(pkg.build.nsis.uninstallDisplayName, "Lworkstation ${version}");

const branch = execFileSync("git", ["branch", "--show-current"], {
  cwd: repositoryRoot,
  encoding: "utf8"
}).trim();
assert.equal(branch, plan.integrationBranch, "official desktop releases must be built from the integration branch");

for (const requirement of plan.requiredCommits) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", requirement.commit, "HEAD"], {
      cwd: repositoryRoot,
      stdio: "ignore"
    });
  } catch {
    throw new Error(`missing required ${requirement.module} commit ${requirement.commit}`);
  }
}

const artifactName = artifactNameFromPattern(pkg.build.win.artifactName, plan.version, "exe");
const releaseRoot = path.join(repositoryRoot, "releases", "latest");
const artifactPath = path.join(releaseRoot, artifactName);

validateLatestArtifacts({ latestRoot: releaseRoot, artifactName, version: plan.version });

const artifact = fs.readFileSync(artifactPath);
const sha256 = crypto.createHash("sha256").update(artifact).digest("hex").toUpperCase();
console.log(JSON.stringify({
  product: plan.product,
  version: plan.version,
  branch,
  requiredCommits: plan.requiredCommits,
  artifact: artifactName,
  bytes: artifact.byteLength,
  sha256
}, null, 2));
