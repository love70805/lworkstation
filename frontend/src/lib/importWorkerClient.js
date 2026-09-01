export function createImportWorkerClient(onProgress) {
  const worker = new Worker(new URL("../workers/import.worker.js", import.meta.url), { type: "module" });
  const pending = new Map();

  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      onProgress?.(data.value);
      return;
    }
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    if (data.type === "error") request.reject(new Error(data.message));
    else request.resolve(data);
  };

  const request = (message, transfer = []) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    pending.set(requestId, { resolve, reject });
    worker.postMessage({ ...message, requestId }, transfer);
  });

  return {
    parse: async (file, jobId) => {
      const buffer = await file.arrayBuffer();
      const extension = file.name.split(".").pop()?.toLowerCase();
      return request({ type: "parse", jobId, extension, buffer }, [buffer]);
    },
    validate: (jobId, mapping, options) => request({ type: "validate", jobId, mapping, options }),
    terminate: () => {
      pending.forEach(({ reject }) => reject(new Error("导入任务已停止。")));
      pending.clear();
      worker.terminate();
    },
  };
}
