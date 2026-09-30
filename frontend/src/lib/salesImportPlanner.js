import { planSalesImports, prepareSalesImportItems } from "../domain/batchSalesImport";

// IndexedDB ownership and its transaction remain on the caller. Only pure
// grouping, summaries and snapshot hashing run in the disposable worker.
export function computeSalesImportPlan(input, { signal } = {}) {
  return runImportComputation({ task: "plan", input }, { signal });
}
export function prepareSalesImportSnapshot(items, { period, signal } = {}) {
  return runImportComputation({ task: "prepare", items, period }, { signal });
}
function runImportComputation(message, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new Error("导入已取消，整批写入已回滚。"));
  if (typeof Worker === "undefined") return message.task === "prepare"
    ? Promise.resolve(prepareSalesImportItems(message.items, { period: message.period })) : planSalesImports(message.input);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/salesImportPlan.worker.js", import.meta.url), { type: "module" });
    const finish = (error, value) => {
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new Error("导入已取消，整批写入已回滚。"));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
    worker.onerror = () => finish(new Error("导入概览计算失败，请重新校验。"));
    worker.onmessageerror = () => finish(new Error("无法读取导入概览，请重新校验。"));
    try { worker.postMessage(message); } catch (error) { finish(error); }
  });
}
