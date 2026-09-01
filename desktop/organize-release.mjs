import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveReleaseFile, artifactNameFromPattern, organizeReleaseArtifacts } from "./release-artifacts.mjs";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(desktopRoot, "..");
const buildRoot = path.join(desktopRoot, "release");
const releasesRoot = path.join(repositoryRoot, "releases");
const latestRoot = path.join(releasesRoot, "latest");
const historyRoot = path.join(releasesRoot, "history");
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(desktopRoot, "release-plan.json"), "utf8"));
const artifactName = artifactNameFromPattern(pkg.build.win.artifactName, plan.version, "exe");

function importLegacyArchive() {
  const legacyRoot = path.join(buildRoot, "archive");
  if (!fs.existsSync(legacyRoot)) return;
  for (const version of fs.readdirSync(legacyRoot)) {
    const source = path.join(legacyRoot, version);
    if (!fs.statSync(source).isDirectory()) continue;
    const destination = path.join(historyRoot, version);
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      archiveReleaseFile(path.join(source, name), path.join(destination, name));
    }
    if (fs.readdirSync(source).length === 0) fs.rmdirSync(source);
  }
  if (fs.readdirSync(legacyRoot).length === 0) fs.rmdirSync(legacyRoot);
}

importLegacyArchive();
const result = organizeReleaseArtifacts({ buildRoot, latestRoot, historyRoot, artifactName, version: plan.version });

console.log(JSON.stringify({
  version: plan.version,
  latest: latestRoot,
  history: historyRoot,
  artifact: artifactName,
  bytes: result.bytes,
  sha256: result.sha256
}, null, 2));
