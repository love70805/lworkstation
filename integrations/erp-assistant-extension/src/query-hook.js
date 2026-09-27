(() => {
  'use strict';
  if (window.__shopeersErpQueryHookV1) return;
  window.__shopeersErpQueryHookV1 = true;

  const LIST_PATH = '/purchase/purchase/v1/purchase-order-page';
  const SENSITIVE_QUERY_KEY = /(token|authorization|cookie|password|secret|capability|endpoint|base.?url)/i;
  let observedSessionState = 'unknown';

  function publish(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), window.location.href);
      if (url.protocol !== 'https:'
        || !(url.hostname === 'zhuolinkeji.cn' || url.hostname.endsWith('.zhuolinkeji.cn'))
        || url.pathname !== LIST_PATH) return;
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

  // A supported ERP shell may replace its route without creating a new document.
  // These notifications contain no authentication or business data.
  function publishRoute() {
    window.dispatchEvent(new CustomEvent('shopeers:erp-v8-route-changed'));
  }
  for (const method of ['pushState', 'replaceState']) {
    const nativeMethod = window.history?.[method];
    if (typeof nativeMethod !== 'function') continue;
    window.history[method] = function () {
      const result = nativeMethod.apply(this, arguments);
      publishRoute();
      return result;
    };
  }
  window.addEventListener('popstate', publishRoute);
  window.addEventListener('hashchange', publishRoute);

  function observeSession(rawUrl, status, payload, redirectedUrl) {
    let url;
    try { url = new URL(rawUrl, window.location.href); } catch { return; }
    if (url.protocol !== 'https:' || !(url.hostname === 'zhuolinkeji.cn' || url.hostname.endsWith('.zhuolinkeji.cn'))) return;
    const loginRequired = status === 401 || status === 403 || /\/(?:login|signin)(?:[/.]|$)/i.test(redirectedUrl || '') || [401, 403].includes(Number(payload?.code))
      || /\/(?:logout|signout)(?:[/.]|$)/i.test(url.pathname) && status >= 200 && status < 300 && [0, '0'].includes(payload?.code);
    const authenticated = !/\/(?:login|signin)(?:[/.]|$)/i.test(window.location.pathname)
      && /^\/(?:purchase|system|permission|user|admin|basic)\//.test(url.pathname)
      && !/(?:login|logout|captcha|register|public)/i.test(url.pathname)
      && status >= 200 && status < 300 && [0, '0'].includes(payload?.code);
    if (!loginRequired && !authenticated) return;
    observedSessionState = loginRequired ? 'login_required' : 'authenticated';
    publishSession();
  }

  function publishSession() {
    if (observedSessionState === 'unknown') return;
    window.dispatchEvent(new CustomEvent('shopeers:erp-v8-session-observed', { detail: { state: observedSessionState } }));
  }
  window.addEventListener('shopeers:erp-v8-session-replay-request', publishSession);

  if (typeof window.fetch === 'function') {
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url || input?.href;
      publish(url);
      const result = nativeFetch.call(this, input, init);
      void Promise.resolve(result).then(response => {
        observeSession(url, response.status, null, response.redirected ? response.url : '');
        if (typeof response.clone !== 'function' || !/json/i.test(response.headers?.get('content-type') || '')) return;
        void response.clone().json().then(payload => observeSession(url, response.status, payload, response.url)).catch(() => {});
      }).catch(() => {});
      return result;
    };
  }

  const xhrPrototype = window.XMLHttpRequest?.prototype;
  if (typeof xhrPrototype?.open === 'function') {
    const nativeOpen = xhrPrototype.open;
    xhrPrototype.open = function (_method, url) {
      publish(typeof url === 'string' ? url : '');
      const result = nativeOpen.apply(this, arguments);
      this.addEventListener?.('load', () => {
        let payload;
        try { payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); } catch { /* non-JSON responses cannot confirm login */ }
        observeSession(url, this.status, payload, this.responseURL);
      }, { once: true });
      return result;
    };
  }
})();
