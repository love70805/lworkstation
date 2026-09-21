const { contextBridge, ipcRenderer } = require("electron");

const versionArgument = process.argv.find((argument) => argument.startsWith("--shopeers-version="));
const version = versionArgument?.slice("--shopeers-version=".length) || "浏览器环境";
const savedAppearance = process.argv.find(argument => argument.startsWith('--shopeers-appearance='))?.split('=')[1] === 'dark' ? 'dark' : 'light';

function reportAppearance(value) {
  ipcRenderer.send("workspace:appearance", value === "dark" ? "dark" : "light");
}

if (typeof document !== "undefined") {
  ipcRenderer.on('workspace:probe', (_event, token) => {
    if (typeof token !== 'string' || token.length > 64) return;
    // This reply stays in the isolated preload; the remote tabs cannot forge it.
    const root = document.querySelector('#root');
    ipcRenderer.send('workspace:probe-result', { token, ready: Boolean(root?.childElementCount) });
  });
  const attachAppearanceObserver = () => {
    const ready = () => {
      const root = document.querySelector('#root');
      if (!root || !root.querySelector('.app-shell, form, [role="alert"], button') || root.querySelector('.boot-loader, .route-loader[role="status"]')) return;
      ipcRenderer.send('workspace:ready');
      readiness.disconnect();
    };
    const readiness = new MutationObserver(ready);
    readiness.observe(document.body, { childList: true, subtree: true });
    ready();
    const report = () => reportAppearance(document.documentElement?.dataset.appearance);
    report();
    if (document.documentElement) {
      new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachAppearanceObserver, { once: true });
  else attachAppearanceObserver();
}

contextBridge.exposeInMainWorld("shopeersDesktopRuntime", Object.freeze({
  desktop: true,
  version,
  appearance: savedAppearance,
  requestInbox: ({ route, method = "GET", query = null, body = null } = {}) => ipcRenderer.invoke("desktop:request-inbox", {
    route,
    method,
    query,
    body,
  }),
}));
