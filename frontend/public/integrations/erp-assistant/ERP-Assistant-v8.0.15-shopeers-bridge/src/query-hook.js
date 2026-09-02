(() => {
  'use strict';
  if (window.__shopeersErpQueryHookV1) return;
  window.__shopeersErpQueryHookV1 = true;

  const LIST_PATH = '/purchase/purchase/v1/purchase-order-page';
  const SENSITIVE_QUERY_KEY = /(token|authorization|cookie|password|secret|capability|endpoint|base.?url)/i;

  function publish(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), window.location.href);
      if (url.pathname !== LIST_PATH) return;
      for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
      }
      window.dispatchEvent(new CustomEvent('shopeers:erp-v8-query-captured', {
        detail: { url: url.href },
      }));
    } catch {
      // The isolated content script validates every accepted query signal again.
    }
  }

  if (typeof window.fetch === 'function') {
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      publish(typeof input === 'string' ? input : input?.url || input?.href);
      return nativeFetch.call(this, input, init);
    };
  }

  const xhrPrototype = window.XMLHttpRequest?.prototype;
  if (typeof xhrPrototype?.open === 'function') {
    const nativeOpen = xhrPrototype.open;
    xhrPrototype.open = function (_method, url) {
      publish(typeof url === 'string' ? url : '');
      return nativeOpen.apply(this, arguments);
    };
  }
})();
