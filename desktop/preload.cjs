const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  noteInboxPopoverToggleIntent: () => ipcRenderer.send("desktop:inbox-popover-toggle-intent"),
  toggleInboxPopover: () => {
    ipcRenderer.send("desktop:inbox-popover-toggle-intent");
    return ipcRenderer.invoke("desktop:toggle-inbox-popover");
  },
  noteUpdatePopoverToggleIntent: () => ipcRenderer.send("desktop:update-popover-toggle-intent"),
  toggleUpdatePopover: (anchor) => {
    ipcRenderer.send("desktop:update-popover-toggle-intent");
    return ipcRenderer.invoke("desktop:toggle-update-popover", anchor);
  },
  switchTab: (tabId) => ipcRenderer.invoke("desktop:switch-tab", tabId),
  back: () => ipcRenderer.invoke("desktop:back"),
  forward: () => ipcRenderer.invoke("desktop:forward"),
  refresh: () => ipcRenderer.invoke("desktop:refresh"),
  openExternal: () => ipcRenderer.invoke("desktop:open-external"),
  adjustErpZoom: (delta) => ipcRenderer.invoke("desktop:adjust-erp-zoom", delta),
  retryExtension: (tabId) => ipcRenderer.invoke("desktop:retry-extension", tabId),
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  cancelUpdate: () => ipcRenderer.invoke("desktop:cancel-update"),
  postponeUpdate: () => ipcRenderer.invoke("desktop:postpone-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  openReleaseNotes: () => ipcRenderer.invoke("desktop:open-release-notes"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:state", listener);
    return () => ipcRenderer.removeListener("desktop:state", listener);
  },
});
