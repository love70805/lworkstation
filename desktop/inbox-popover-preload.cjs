const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inboxPopover", {
  getState: () => ipcRenderer.invoke("desktop:get-inbox-popover-state"),
  close: () => ipcRenderer.invoke("desktop:close-inbox-popover"),
  resize: (height) => ipcRenderer.invoke("desktop:resize-inbox-popover", height),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:inbox-popover-state", listener);
    return () => ipcRenderer.removeListener("desktop:inbox-popover-state", listener);
  },
});
