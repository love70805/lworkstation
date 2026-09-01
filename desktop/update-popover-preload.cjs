const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("updatePopover", {
  getState: () => ipcRenderer.invoke("desktop:get-update-popover-state"),
  close: () => ipcRenderer.invoke("desktop:close-update-popover"),
  resize: (height) => ipcRenderer.invoke("desktop:resize-update-popover", height),
  check: () => ipcRenderer.invoke("desktop:check-update"),
  download: () => ipcRenderer.invoke("desktop:download-update"),
  cancel: () => ipcRenderer.invoke("desktop:cancel-update"),
  retry: () => ipcRenderer.invoke("desktop:check-update"),
  install: () => ipcRenderer.invoke("desktop:install-update"),
  postpone: () => ipcRenderer.invoke("desktop:postpone-update"),
  openReleaseNotes: () => ipcRenderer.invoke("desktop:open-release-notes"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:update-popover-state", listener);
    return () => ipcRenderer.removeListener("desktop:update-popover-state", listener);
  },
});
