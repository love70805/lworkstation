function isAllowedWorkspaceUrl(value, devUrl = "") {
  try {
    const target = new URL(value);
    if (devUrl) return target.origin === new URL(devUrl).origin;
    return target.protocol === "shopeers:" && target.hostname === "workstation";
  } catch {
    return false;
  }
}

module.exports = { isAllowedWorkspaceUrl };
