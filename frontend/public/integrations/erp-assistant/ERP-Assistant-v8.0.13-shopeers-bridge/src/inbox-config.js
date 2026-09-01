(() => {
  'use strict';

  const INBOX_BASE_URL_KEY = 'shopeersErpInboxBaseUrl';

  function validInboxBaseUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  function publish(value) {
    const baseUrl = validInboxBaseUrl(value);
    if (baseUrl) document.documentElement.dataset.shopeersErpInboxBaseUrl = baseUrl;
    else delete document.documentElement.dataset.shopeersErpInboxBaseUrl;
  }

  chrome.storage.local.get(INBOX_BASE_URL_KEY).then((stored) => publish(stored[INBOX_BASE_URL_KEY])).catch(() => {});
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[INBOX_BASE_URL_KEY]) publish(changes[INBOX_BASE_URL_KEY].newValue);
  });
})();
