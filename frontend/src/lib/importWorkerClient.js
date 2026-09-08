export function createImportWorkerClient(onProgress) {
  const worker = new Worker(new URL("../workers/import.worker.js", import.meta.url), { type: "module" });
  const pending = new Map();
  let failure = null;
  const rejectPending = (message) => {
    pending.forEach(({ reject }) => reject(new Error(message)));
    pending.clear();
  };
  worker.onerror = () => {
    failure = "文件解析线程发生错误，请刷新页面后重新选择文件。";
    rejectPending(failure);
  };
  worker.onmessageerror = () => rejectPending("无法读取文件解析结果，请重新选择文件。");

  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      onProgress?.(data.value, data.jobId);
      return;
    }
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    if (data.type === "error") request.reject(new Error(data.message));
    else request.resolve(data);
  };

  const request = (message, transfer = []) => new Promise((resolve, reject) => {
    if (failure) { reject(new Error(failure)); return; }
    const requestId = crypto.randomUUID();
    pending.set(requestId, { resolve, reject });
    try { worker.postMessage({ ...message, requestId }, transfer); }
    catch (error) { pending.delete(requestId); reject(error); }
  });

  return {
    parse: async (file, jobId) => {
      const buffer = await file.arrayBuffer();
      const extension = file.name.split(".").pop()?.toLowerCase();
      return request({ type: "parse", jobId, extension, buffer }, [buffer]);
    },
    validate: (jobId, mapping, options) => request({ type: "validate", jobId, mapping, options }),
    release: (jobId) => request({ type: "release", jobId }),
    terminate: () => {
      failure = "导入任务已停止。";
      rejectPending("导入任务已停止。");
      worker.terminate();
    },
  };
}
