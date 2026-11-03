const refreshEvent = 'shopeers:erp-inbox-refresh';

export function requestErpInboxRefresh() {
  window.dispatchEvent(new Event(refreshEvent));
}

export function subscribeErpInboxRefresh(callback) {
  const unsubscribe = window.shopeersDesktopRuntime?.onInboxChanged?.(callback);
  window.addEventListener(refreshEvent, callback);
  return () => { unsubscribe?.(); window.removeEventListener(refreshEvent, callback); };
}

export function erpInboxRecoveryInterval() {
  return window.shopeersDesktopRuntime?.onInboxChanged ? 30_000 : 5000;
}
