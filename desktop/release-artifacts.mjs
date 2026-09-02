import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SETUP_PATTERN = /^(.+?) Setup (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\.exe$/;
const ALLOWED_SUFFIXES = new Set(["latest.yml", "beta.yml", "SHA256.txt"]);

function canonicalInstallerName(name) {
  return String(name || "").replace(/^Lworkstation-Setup-/, "Lworkstation Setup ");
}

function sha256(file, ops = fs) {
  return crypto.createHash("sha256").update(ops.readFileSync(file)).digest("hex").toUpperCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function artifactNameFromPattern(pattern, version, ext = "exe") {
  return pattern.replace("${version}", version).replace("${ext}", ext);
}

export function installerVersion(name) {
  return canonicalInstallerName(name).match(SETUP_PATTERN)?.[2] ?? null;
}

function ensureDirectory(directory, ops = fs) {
  ops.mkdirSync(directory, { recursive: true });
}

function uniqueDestination(destination, ops = fs) {
  if (!ops.existsSync(destination)) return destination;
  const extension = path.extname(destination);
  const stem = destination.slice(0, -extension.length);
  for (let index = 1; ; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!ops.existsSync(candidate)) return candidate;
  }
}

export function archiveReleaseFile(source, destination, ops = fs) {
  ensureDirectory(path.dirname(destination), ops);
  if (ops.existsSync(destination)) {
    try {
      if (ops.readFileSync(source).equals(ops.readFileSync(destination))) {
        ops.rmSync(source, { force: true });
        return destination;
      }
    } catch {}
    destination = uniqueDestination(destination, ops);
  }
  ops.renameSync(source, destination);
  return destination;
}

function archiveDestinationFor(name, historyRoot, fallbackVersion) {
  const directVersion = installerVersion(name);
  if (directVersion) return path.join(historyRoot, directVersion, name);
  if (name.endsWith(".blockmap")) {
    const baseName = name.slice(0, -".blockmap".length);
    const blockVersion = installerVersion(baseName);
    if (blockVersion) return path.join(historyRoot, blockVersion, name);
  }
  if (ALLOWED_SUFFIXES.has(name)) return path.join(historyRoot, fallbackVersion, name);
  return path.join(historyRoot, "unclassified", name);
}

export function validateLatestArtifacts({ latestRoot, artifactName, version, metadataFile = "latest.yml", ops = fs }) {
  const hashedArtifacts = [artifactName, `${artifactName}.blockmap`, metadataFile];
  const expected = new Set([...hashedArtifacts, "SHA256.txt"]);
  if (!ops.existsSync(latestRoot)) throw new Error(`missing release directory: ${latestRoot}`);
  const actual = new Set(ops.readdirSync(latestRoot));
  for (const name of expected) if (!actual.has(name)) throw new Error(`missing release artifact: ${name}`);
  for (const name of actual) if (!expected.has(name)) throw new Error(`unexpected release artifact: ${name}`);
  const metadata = ops.readFileSync(path.join(latestRoot, metadataFile), "utf8");
  if (!new RegExp(`^version:\\s*${escapeRegExp(version)}\\s*$`, "m").test(metadata)) {
    throw new Error(`${metadataFile} version does not match release plan`);
  }
  const exeReferences = [...metadata.matchAll(/^\s*(?:-\s*)?(?:path|url):\s*["']?(.+?\.exe)["']?\s*$/gm)]
    .map((match) => {
      const value = match[1].trim();
      try { return decodeURIComponent(value); } catch { return value; }
    });
  if (exeReferences.some((name) => canonicalInstallerName(name) !== canonicalInstallerName(artifactName))) {
    throw new Error(`${metadataFile} references a non-current installer`);
  }
  if (!exeReferences.some((name) => canonicalInstallerName(name) === canonicalInstallerName(artifactName))) {
    throw new Error(`${metadataFile} must reference the current installer`);
  }
  const recordedHashes = new Map(ops.readFileSync(path.join(latestRoot, "SHA256.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Fa-f0-9]{64})\s{2}(.+)$/))
    .filter(Boolean)
    .map((match) => [match[2], match[1].toUpperCase()]));
  for (const name of hashedArtifacts) {
    if (recordedHashes.get(name) !== sha256(path.join(latestRoot, name), ops)) {
      throw new Error(`SHA256.txt does not match release artifact: ${name}`);
    }
  }
  return true;
}

export function organizeReleaseArtifacts({ buildRoot, latestRoot, historyRoot, artifactName, version, metadataFile = "latest.yml", ops = fs }) {
  ensureDirectory(latestRoot, ops);
  ensureDirectory(historyRoot, ops);
  const currentArtifacts = [artifactName, `${artifactName}.blockmap`, metadataFile];
  const missingBuildArtifact = currentArtifacts.find((name) => !ops.existsSync(path.join(buildRoot, name)));
  if (missingBuildArtifact) {
    try {
      validateLatestArtifacts({ latestRoot, artifactName, version, metadataFile, ops });
      const artifact = ops.readFileSync(path.join(latestRoot, artifactName));
      return { artifactName, version, bytes: artifact.byteLength, sha256: sha256(path.join(latestRoot, artifactName), ops) };
    } catch {
      throw new Error(`missing release artifact: ${missingBuildArtifact}`);
    }
  }
  const previousNames = ops.readdirSync(latestRoot);
  const previousVersions = [...new Set(previousNames.map(installerVersion).filter(Boolean))];
  const fallbackVersion = previousVersions.length === 1 ? previousVersions[0] : version;
  for (const name of previousNames) {
    const source = path.join(latestRoot, name);
    const destination = archiveDestinationFor(name, historyRoot, fallbackVersion);
    archiveReleaseFile(source, destination, ops);
  }
  for (const name of currentArtifacts) {
    const source = path.join(buildRoot, name);
    const destination = path.join(latestRoot, name);
    ensureDirectory(path.dirname(destination), ops);
    ops.renameSync(source, destination);
  }
  const artifact = ops.readFileSync(path.join(latestRoot, artifactName));
  const hashes = currentArtifacts.map((name) => `${sha256(path.join(latestRoot, name), ops)}  ${name}`);
  ops.writeFileSync(path.join(latestRoot, "SHA256.txt"), `${hashes.join("\n")}\n`, "utf8");
  validateLatestArtifacts({ latestRoot, artifactName, version, metadataFile, ops });
  return { artifactName, version, bytes: artifact.byteLength, sha256: sha256(path.join(latestRoot, artifactName), ops) };
}
