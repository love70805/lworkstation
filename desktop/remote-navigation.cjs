const REMOTE_DOMAINS = {
  erp: ["zhuolinkeji.cn"],
  "1688": ["1688.com", "taobao.com", "tmall.com", "alibaba.com"],
};

function normalizeAllowedRemoteUrl(tabId, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const domains = REMOTE_DOMAINS[tabId] || [];
    const host = url.hostname.toLowerCase();
    if (!domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    url.protocol = "https:";
    return url.href;
  } catch (_) {
    return null;
  }
}

function resolveRemotePopup(tabId, value) {
  const url = normalizeAllowedRemoteUrl(tabId, value);
  return url ? { action: "navigate", url } : { action: "block", url: null };
}

module.exports = { normalizeAllowedRemoteUrl, resolveRemotePopup };
