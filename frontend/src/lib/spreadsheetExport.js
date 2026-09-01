function safeFileName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-");
}

export function exportWorkbook(rows, fileName, sheetName = "Export") {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/import.worker.js", import.meta.url), { type: "module" });
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("表格生成超时。"));
    }, 30000);

    worker.onmessage = ({ data }) => {
      if (data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (data.type === "error") {
        reject(new Error(data.message));
        return;
      }
      const url = URL.createObjectURL(new Blob([data.bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFileName(fileName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    };

    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error("表格后台任务执行失败。"));
    };
    worker.postMessage({ type: "export", requestId, rows, sheetName });
  });
}
