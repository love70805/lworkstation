const semver = require("semver");

function versionChannel(value) {
  if (typeof value !== "string" || !semver.valid(value) || /^[v=\s]/.test(value)) return null;
  const pre = semver.prerelease(value);
  if (!pre) return "latest";
  return pre[0] === "beta" ? "beta" : null;
}

function canUpdate(current, target, channel) {
  return Boolean(channel && versionChannel(current) === channel
    && versionChannel(target) === channel && semver.gt(target, current));
}

module.exports = { versionChannel, canUpdate };
