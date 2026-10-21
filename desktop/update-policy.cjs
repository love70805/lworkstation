const semver = require("semver");

function versionChannel(value) {
  if (typeof value !== "string" || !semver.valid(value) || /^[v=\s]/.test(value)) return null;
  const pre = semver.prerelease(value);
  if (!pre) return "latest";
  if (pre[0] === "beta") return "beta";
  return pre[0] === "rc" && pre.length === 2 && Number.isSafeInteger(pre[1]) && pre[1] > 0 ? "rc" : null;
}

function canUpdate(current, target, channel) {
  return Boolean(channel && versionChannel(current) === channel
    && versionChannel(target) === channel && semver.gt(target, current));
}

module.exports = { versionChannel, canUpdate };
