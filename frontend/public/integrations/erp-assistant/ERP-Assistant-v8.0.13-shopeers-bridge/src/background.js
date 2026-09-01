(() => {
  'use strict';

  const DEFAULT_INBOX_BASE_URL = 'http://127.0.0.1:8790';
  const INBOX_BASE_URL_KEY = 'shopeersErpInboxBaseUrl';
  const version = '8.0.13';

  function validInboxBaseUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  async function inboxBaseUrl() {
    try {
      const stored = await chrome.storage.local.get(INBOX_BASE_URL_KEY);
      return validInboxBaseUrl(stored[INBOX_BASE_URL_KEY]) || DEFAULT_INBOX_BASE_URL;
    } catch {
      return DEFAULT_INBOX_BASE_URL;
    }
  }

  async function reportInstalled() {
    try {
      await fetch(`${await inboxBaseUrl()}/erp/v1/extension-status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          extensionId: 'erp-assistant-installation',
          version,
          ready: false,
          pageUrl: '',
          context: 'extension-background'
        })
      });
    } catch {
      // The local inbox may not be running yet; the next alarm retries.
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('erp-assistant-heartbeat', { periodInMinutes: 1 });
    reportInstalled();
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('erp-assistant-heartbeat', { periodInMinutes: 1 });
    reportInstalled();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'erp-assistant-heartbeat') reportInstalled();
  });

  reportInstalled();
})();
