export function serializeWorkspaceBackup(payload) {
  const json = JSON.stringify(payload, null, 2);
  return {
    json,
    sizeBytes: new Blob([json]).size,
  };
}

export function downloadWorkspaceBackup(payload, { prefix = "shopeers-backup" } = {}) {
  const { json, sizeBytes } = serializeWorkspaceBackup(payload);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const generatedAt = new Date(payload.generatedAt ?? Date.now());
  const date = [
    generatedAt.getFullYear(),
    String(generatedAt.getMonth() + 1).padStart(2, "0"),
    String(generatedAt.getDate()).padStart(2, "0"),
  ].join("-");
  const fileName = `${prefix}-${date}.json`;
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { fileName, sizeBytes };
}
