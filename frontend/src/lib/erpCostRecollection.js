import { ensureAutoErpRequest } from './autoErpRequest';

export function prepareCostRecollection(input, { scopeKey, task = null, requestId = null } = {}) {
  if (!input?.ledger?.workspaceId || !input.ledger.id || !input.platformSkcs?.length || !input.expectedSkus?.length) throw new Error('当前范围没有可采集的商品。');
  if (task && (task.workspaceId !== input.ledger.workspaceId || task.ledgerId !== input.ledger.id)) throw new Error('旧任务不属于当前工作区或月份。');
  return { input: structuredClone(input), scopeKey, task: task ? structuredClone(task) : null,
    previousRequestId: task?.requestId ?? requestId, stopped: false, request: null, pending: null, result: null };
}

// One confirmed operation retains its new request even when transport fails.
// Old receipts and business costs are never deleted by this coordinator.
export function runCostRecollection(intent, { isCurrent, stopTask, start, onPrepared, ensure = ensureAutoErpRequest, ...registration }) {
  if (intent.pending) return intent.pending;
  const assertCurrent = () => { if (!isCurrent(intent)) throw new Error('月份、筛选范围或台账已变化，请关闭后重新确认。'); };
  const run = (async () => {
    assertCurrent();
    if (intent.result?.ok) return intent.result;
    if (intent.task && !intent.stopped) {
      await stopTask(intent.task);
      intent.stopped = true;
      assertCurrent();
    }
    if (!intent.request) {
      if (!intent.rejectedRequestCaptured) {
        const latest = await registration.latest?.(intent.input.ledger.id);
        assertCurrent();
        intent.rejectedRequestId = latest?.id ?? intent.previousRequestId;
        intent.rejectedRequestCaptured = true;
      }
      intent.request = await ensure(intent.input, { ...registration, rejectedRequestId: intent.rejectedRequestId,
        isCurrent: () => isCurrent(intent) });
      assertCurrent();
    }
    assertCurrent();
    if (!intent.request?.id || [intent.previousRequestId, intent.rejectedRequestId].includes(intent.request.id)) { intent.request = null; throw new Error('未能建立新的采集请求，请重试。'); }
    onPrepared?.(intent.request);
    const result = await start({ workspaceId: intent.input.ledger.workspaceId, ledgerId: intent.input.ledger.id,
      requestId: intent.request.id, mode: 'cost', retryFailed: true });
    if (!result?.ok) throw new Error(result?.error || '重新获取尚未启动，请重试。');
    intent.result = result;
    return result;
  })();
  intent.pending = run;
  void run.finally(() => { if (intent.pending === run) intent.pending = null; }).catch(() => {});
  return run;
}
