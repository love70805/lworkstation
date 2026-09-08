// Test-only harness: execute the actual candidate main.cjs with synthetic profiles.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.SINGLE_INSTANCE_SMOKE_ROOT;
const id = process.env.SINGLE_INSTANCE_SMOKE_ID;
if (!root || !id || !process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA) throw new Error("isolated smoke settings required");
const reportPath = path.join(root, `${id}.json`);
const commandPath = path.join(root, `${id}.command.json`);
let report = { pid: process.pid, initialized: false, sequence: 0 };
const write = () => fs.writeFileSync(reportPath, JSON.stringify(report));
app.whenReady().then(() => {
  for (const current of [session.defaultSession, session.fromPartition("persist:erp"), session.fromPartition("persist:1688")]) {
    current.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: ["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1" });
    });
  }
});
require("./main.cjs");
// app.exit in the losing candidate prevents reaching here or the ready callback.
report.initialized = true;
write();
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const window = BrowserWindow.getAllWindows().find(w => w.getTitle() === "Lworkstation");
    if (!window || window.isDestroyed()) return;
    const view = window.contentView.children.find(child => child.webContents?.getURL().startsWith(process.env.SHOPEERS_DESKTOP_DEV_URL));
    report.ready = Boolean(view && !view.webContents.isLoading());
    report.minimized = window.isMinimized();
    report.visible = window.isVisible();
    report.focused = window.isFocused();
    let command;
    try { command = JSON.parse(fs.readFileSync(commandPath, "utf8")); } catch (_) {}
    if (command && command.sequence > report.sequence) {
      if (command.action === "minimize") window.minimize();
      if (command.action === "probe") {
        report.data = await view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const request = indexedDB.open('single-instance-synthetic', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('settings');
          request.onerror = () => reject(String(request.error));
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('settings', 'readwrite');
            const store = transaction.objectStore('settings');
            store.put('retained', 'sentinel');
            const read = store.get('sentinel');
            transaction.oncomplete = () => { db.close(); resolve(read.result); };
            transaction.onerror = () => { db.close(); reject(String(transaction.error)); };
          };
        })`);
      }
      report.sequence = command.sequence;
      if (command.action === "quit") { clearInterval(timer); app.quit(); }
    }
    write();
  } catch (error) { report.error = String(error); write(); }
  finally { busy = false; }
}, 100);
