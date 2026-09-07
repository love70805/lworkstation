const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_BETA_CONFIG = Object.freeze({
  enabled: true,
  provider: "github",
  owner: "love70805",
  repo: "lworkstation",
  private: false,
  channel: "beta",
});

function isPrereleaseVersion(value) {
  return /^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z][0-9A-Za-z.-]*$/.test(String(value || ""));
}

function assertBetaUpdateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Beta update configuration must be an object.");
  }
  const expectedKeys = Object.keys(EXPECTED_BETA_CONFIG).sort();
  const actualKeys = Object.keys(config).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("Beta update configuration must not contain extra fields or credentials.");
  }
  for (const [key, expected] of Object.entries(EXPECTED_BETA_CONFIG)) {
    if (config[key] !== expected) {
      throw new Error(`Beta update configuration has an invalid ${key} value.`);
    }
  }
  return Object.freeze({ ...EXPECTED_BETA_CONFIG });
}

function loadReleaseBetaConfig(root = __dirname, operations = fs) {
  const source = path.join(root, "update-beta-config.json");
  let parsed;
  try {
    parsed = JSON.parse(operations.readFileSync(source, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read beta update configuration: ${error.message}`);
  }
  return assertBetaUpdateConfig(parsed);
}

function writeReleaseBetaConfig(context, { root = __dirname, operations = fs } = {}) {
  const version = context?.packager?.appInfo?.version;
  if (!isPrereleaseVersion(version)) {
    throw new Error(`Refusing to enable beta updates for non-prerelease version ${String(version || "(missing)")}.`);
  }
  if (typeof context?.appOutDir !== "string" || !context.appOutDir) {
    throw new Error("Electron Builder afterPack context is missing appOutDir.");
  }

  const appOutDir = path.resolve(context.appOutDir);
  const resourcesDir = path.resolve(appOutDir, "resources");
  const target = path.resolve(resourcesDir, "update-config.json");
  if (path.dirname(resourcesDir) !== appOutDir || path.dirname(target) !== resourcesDir) {
    throw new Error("Refusing an invalid packaged resources path.");
  }
  if (!operations.existsSync(resourcesDir) || !operations.existsSync(target)) {
    throw new Error("Packaged update-config.json is missing from resources.");
  }

  const config = loadReleaseBetaConfig(root, operations);
  operations.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { version, target, config };
}

async function installReleaseBetaConfig(context) {
  return writeReleaseBetaConfig(context);
}

module.exports = installReleaseBetaConfig;
module.exports.EXPECTED_BETA_CONFIG = EXPECTED_BETA_CONFIG;
module.exports.assertBetaUpdateConfig = assertBetaUpdateConfig;
module.exports.isPrereleaseVersion = isPrereleaseVersion;
module.exports.loadReleaseBetaConfig = loadReleaseBetaConfig;
module.exports.writeReleaseBetaConfig = writeReleaseBetaConfig;
