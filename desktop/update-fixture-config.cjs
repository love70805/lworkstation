const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_REPOSITORY = Object.freeze({
  owner: "love70805",
  repo: "lworkstation",
});
const ARTIFACT_PATTERN = "Lworkstation-Setup-${version}.${ext}";

function artifactNameFor(version) {
  return `Lworkstation-Setup-${version}.exe`;
}

function assertBetaUpdateConfig(config) {
  const expected = {
    enabled: true,
    provider: "github",
    owner: EXPECTED_REPOSITORY.owner,
    repo: EXPECTED_REPOSITORY.repo,
    private: false,
    channel: "beta",
  };
  if (JSON.stringify(config) !== JSON.stringify(expected)) {
    throw new Error("beta 更新配置必须是无 token 的 GitHub prerelease beta 通道");
  }
  return config;
}

function loadUpdateFixtureConfig(root) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "update-test-config.json"), "utf8"));
  const expected = {
    enabled: false,
    purpose: "beta-smoke-only",
    channel: "beta",
    releaseType: "prerelease",
    sourceVersion: "0.2.6-beta.3",
    targetVersion: "0.2.6-beta.4",
    artifactPattern: ARTIFACT_PATTERN,
    metadataFile: "beta.yml",
    betaConfigFile: "update-beta-config.json",
    feed: "loopback-only",
    repository: {
      ...EXPECTED_REPOSITORY,
      sourceTag: "v0.2.6-beta.3",
      targetTag: "v0.2.6-beta.4",
    },
    status: "prepared-not-published",
  };
  if (JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error("更新夹具必须明确为 0.2.6-beta.3 -> 0.2.6-beta.4 beta 通道验证");
  }
  const betaConfigPath = path.join(root, raw.betaConfigFile);
  const betaConfig = assertBetaUpdateConfig(JSON.parse(fs.readFileSync(betaConfigPath, "utf8")));
  return Object.freeze({
    ...raw,
    betaConfig,
    betaConfigPath,
    sourceArtifactName: artifactNameFor(raw.sourceVersion),
    targetArtifactName: artifactNameFor(raw.targetVersion),
  });
}

function metadataAssetNames(contents) {
  return [...String(contents).matchAll(/^\s*(?:-\s*)?(?:path|url):\s*([^\s]+\.exe)\s*$/gm)].map((match) => match[1]);
}

module.exports = {
  ARTIFACT_PATTERN,
  EXPECTED_REPOSITORY,
  artifactNameFor,
  assertBetaUpdateConfig,
  loadUpdateFixtureConfig,
  metadataAssetNames,
};
