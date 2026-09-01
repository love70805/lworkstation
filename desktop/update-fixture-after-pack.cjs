const fs = require("node:fs");
const path = require("node:path");
const { loadUpdateFixtureConfig } = require("./update-fixture-config.cjs");

module.exports = async function installBetaFixtureConfig(context) {
  const config = loadUpdateFixtureConfig(__dirname);
  const version = context.packager.appInfo.version;
  if (![config.sourceVersion, config.targetVersion].includes(version)) {
    throw new Error(`拒绝向非 beta 夹具 ${version} 写入 beta 更新配置`);
  }
  const target = path.join(context.appOutDir, "resources", "update-config.json");
  fs.copyFileSync(config.betaConfigPath, target);
};
