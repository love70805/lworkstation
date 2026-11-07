const semver = require("semver");

function versionChannel(value, edition) {
  if (typeof value !== "string" || !semver.valid(value) || /^[v=\s]/.test(value)) return null;
  const pre = semver.prerelease(value);
  if (edition === "beta") return pre?.[0] === "beta" ? "beta-sidecar" : null;
  if (!pre) return "latest";
  if (pre[0] === "beta") return "beta";
  return pre[0] === "rc" && pre.length === 2 && Number.isSafeInteger(pre[1]) && pre[1] > 0 ? "rc" : null;
}

function canUpdate(current, target, channel) {
  const edition = channel === "beta-sidecar" ? "beta" : undefined;
  return Boolean(channel && versionChannel(current, edition) === channel
    && versionChannel(target, edition) === channel && semver.gt(target, current));
}

function versionFromTag(tag, channel) {
  if (typeof tag !== "string") return null;
  const sidecar = channel === "beta-sidecar";
  if (sidecar && !tag.startsWith("beta-sidecar-v")) return null;
  const version = sidecar ? tag.slice("beta-sidecar-v".length) : tag.replace(/^v/, "");
  return versionChannel(version, sidecar ? "beta" : undefined) === channel ? version : null;
}

module.exports = { versionChannel, canUpdate, versionFromTag };
