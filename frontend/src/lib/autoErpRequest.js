import { buildLedgerErpCostRequest } from "./erpRequest";

export function erpRequestScopeKey({ ledger, platformSkcs, expectedSkus }) {
  return JSON.stringify([ledger?.workspaceId, ledger?.id,
    (platformSkcs ?? []).map((item) => String(item.platformSkc ?? item).normalize("NFKC").trim().toUpperCase()).sort(),
    (expectedSkus ?? []).map((item) => [item.platformSku, item.platformSkc]).sort(),
  ]);
}

const chains = new Map();
export function ensureAutoErpRequest(input, { latest, save, register, isCurrent = () => true, now = () => Date.now() }) {
  const key = `${input.ledger.workspaceId}:${input.ledger.id}`;
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    if (!isCurrent()) return null;
    const existing = await latest(input.ledger.id);
    if (!isCurrent()) return null;
    const sameScope = existing && erpRequestScopeKey({ ...existing, ledger: input.ledger }) === erpRequestScopeKey(input);
    const reusable = sameScope && now() - Date.parse(existing.requestedAt) < 90 * 60 * 1000;
    let request = reusable ? existing : { ...buildLedgerErpCostRequest(input), supersedesRequestId: existing?.id ?? null };
    await save(request);
    if (!isCurrent()) return null;
    let response = await register({ request, expectedSkus: input.expectedSkus });
    if (!response?.accepted) throw new Error("本机服务尚未确认登记请求");
    if (!isCurrent()) { await register({ request: { ...request, cancel: true } }); return null; }
    if (response.status && response.status !== "registered") {
      request = { ...buildLedgerErpCostRequest(input), supersedesRequestId: request.id };
      await save(request);
      if (!isCurrent()) return null;
      response = await register({ request, expectedSkus: input.expectedSkus });
      if (!response?.accepted || (response.status && response.status !== "registered")) throw new Error("ERP 请求未能续期");
      if (!isCurrent()) { await register({ request: { ...request, cancel: true } }); return null; }
    }
    return request;
  });
  chains.set(key, run);
  void run.finally(() => { if (chains.get(key) === run) chains.delete(key); }).catch(() => {});
  return run;
}

export function cancelAutoErpRequest(ledger, { latest, register }) {
  const key = `${ledger.workspaceId}:${ledger.id}`;
  const run = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const request = await latest(ledger.id);
    if (request?.workspaceId === ledger.workspaceId) return register({ request: { ...request, cancel: true } });
    return null;
  });
  chains.set(key, run);
  void run.finally(() => { if (chains.get(key) === run) chains.delete(key); }).catch(() => {});
  return run;
}
