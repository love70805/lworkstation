(() => {
  'use strict';

  const endpoint = 'http://127.0.0.1:8790/erp/v1/extension-status';
  const version = '8.0.5';

  async function reportInstalled() {
    try {
      await fetch(endpoint, {
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
