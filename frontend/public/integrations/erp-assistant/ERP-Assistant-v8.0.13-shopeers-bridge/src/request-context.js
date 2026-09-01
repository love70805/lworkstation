(function (global) {
  'use strict';

  function canonical(value) {
    return String(value ?? '').normalize('NFKC').trim().toUpperCase();
  }

  function normalizedSkcs(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((item) => canonical(item && typeof item === 'object' ? item.platformSkc : item))
      .filter(Boolean))].sort();
  }

  function sameSkcs(left, right) {
    const a = normalizedSkcs(left);
    const b = normalizedSkcs(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function requestError(code, message, status = 409) {
    return Object.assign(new Error(`${code}：${message}`), { code, status });
  }

  function deliverySourceMeta(meta) {
    const result = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
    delete result.cacheRestored;
    delete result.deliveryTerminal;
    return result;
  }

  async function settleRequestContext(value, timeoutMs = 0) {
    let timeoutId = null;
    try {
      const timeout = Number(timeoutMs);
      const contextPromise = Promise.resolve(value);
      const boundedPromise = Number.isFinite(timeout) && timeout > 0 && typeof global.setTimeout === 'function'
        ? Promise.race([
            contextPromise,
            new Promise((_, reject) => {
              timeoutId = global.setTimeout(() => reject(requestError(
                'ERP_REQUEST_CONTEXT_TIMEOUT',
                '读取自动回传上下文超时，本地核算继续。',
                408
              )), timeout);
            }),
          ])
        : contextPromise;
      return { context: await boundedPromise || null, error: null };
    } catch (error) {
      return {
        context: null,
        error: {
          code: String(error?.code || 'ERP_REQUEST_CONTEXT_FAILED'),
          message: String(error?.message || error || 'ERP 请求上下文读取失败'),
        },
      };
    } finally {
      if (timeoutId !== null && typeof global.clearTimeout === 'function') global.clearTimeout(timeoutId);
    }
  }

  async function runWithOptionalRequestContext(value, calculate, timeoutMs = 0) {
    if (typeof calculate !== 'function') throw new TypeError('calculate must be a function');
    const settled = await settleRequestContext(value, timeoutMs);
    return { ...settled, result: await calculate(settled) };
  }

  function mergeQuerySnapshot(live = {}, cached = {}) {
    return {
      capturedUrl: String(live?.capturedUrl || cached?.capturedUrl || '').trim(),
      queryCapturedAt: String(live?.queryCapturedAt || cached?.queryCapturedAt || cached?.registeredBefore || '').trim(),
    };
  }

  function shouldReplayDelivery(cache) {
    return Boolean(cache && cache.deliveryTerminal !== true);
  }

  function resolveUniqueRequest(records, {
    requestId = '',
    ledgerId = '',
    workspaceId = '',
    querySkcs = [],
    registeredBefore = '',
  } = {}) {
    const normalizedQuerySkcs = normalizedSkcs(querySkcs);
    if (normalizedQuerySkcs.length === 0) return null;
    const snapshotAt = Date.parse(String(registeredBefore || ''));
    const candidates = (Array.isArray(records) ? records : []).filter((request) => {
      if (request?.status && request.status !== 'registered') return false;
      if (requestId && String(request?.requestId || '').trim() !== String(requestId).trim()) return false;
      if (ledgerId && String(request?.ledgerId || '').trim() !== String(ledgerId).trim()) return false;
      if (workspaceId && String(request?.workspaceId || '').trim() !== String(workspaceId).trim()) return false;
      const registeredAt = Date.parse(String(request?.registeredAt || request?.requestedAt || ''));
      if (Number.isFinite(snapshotAt) && (!Number.isFinite(registeredAt) || registeredAt > snapshotAt)) return false;
      return sameSkcs(request?.platformSkcs, normalizedQuerySkcs);
    });
    if (candidates.length > 1) {
      throw requestError('ERP_REQUEST_AMBIGUOUS', '多个 ERP 请求同时匹配当前工作区、账本时间和完整 SKC 集合，请从 Shopeers 重新复制本次查询范围。');
    }
    if (candidates.length === 0) return null;
    const request = candidates[0];
    return {
      requestId: String(request.requestId || '').trim(),
      ledgerId: String(request.ledgerId || '').trim(),
      workspaceId: String(request.workspaceId || '').trim(),
      requestRegisteredAt: String(request.registeredAt || request.requestedAt || '').trim(),
    };
  }

  global.ShopeersErpRequestContext = Object.freeze({
    canonical,
    normalizedSkcs,
    sameSkcs,
    requestError,
    deliverySourceMeta,
    settleRequestContext,
    runWithOptionalRequestContext,
    mergeQuerySnapshot,
    shouldReplayDelivery,
    resolveUniqueRequest,
  });
})(typeof window === 'object' ? window : globalThis);
