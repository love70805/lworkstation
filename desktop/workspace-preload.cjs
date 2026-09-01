const { contextBridge, ipcRenderer } = require("electron");

const versionArgument = process.argv.find((argument) => argument.startsWith("--shopeers-version="));
const version = versionArgument?.slice("--shopeers-version=".length) || "浏览器环境";

function reportAppearance(value) {
  ipcRenderer.send("workspace:appearance", value === "dark" ? "dark" : "light");
}

if (typeof document !== "undefined") {
  const attachAppearanceObserver = () => {
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
  requestInbox: ({ route, method = "GET", query = null, body = null } = {}) => ipcRenderer.invoke("desktop:request-inbox", {
    route,
    method,
    query,
    body,
  }),
}));
