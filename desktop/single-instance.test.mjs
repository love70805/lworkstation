import assert from "node:assert/strict";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { acquireDesktopInstance } = require("./single-instance.cjs");
const app = new EventEmitter();
app.requestSingleInstanceLock = () => true;
const instance = acquireDesktopInstance(app);
const calls = [];
let destroyed = false;
const window = {
  isDestroyed: () => destroyed, isMinimized: () => true,
  restore: () => calls.push("restore"), show: () => calls.push("show"), focus: () => calls.push("focus"),
};
app.emit("second-instance");
assert.deepEqual(calls, []);
instance.windowReady(window);
assert.deepEqual(calls, ["restore", "show", "focus"]);
calls.length = 0;
app.emit("second-instance");
assert.deepEqual(calls, ["restore", "show", "focus"]);
destroyed = true;
calls.length = 0;
app.emit("second-instance");
assert.deepEqual(calls, []);

// Execute the actual main-module prefix, allowing only pre-lock dependencies.
// A return after app.exit is required even if exit were delayed/stubbed.
const main = fs.readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
let exited = null;
let requested = false;
const fakeApp = {
  requestSingleInstanceLock() { requested = true; return false; },
  exit(code) { exited = code; },
  setPath() {},
};
new Function("require", "process", main)((name) => {
  if (name === "electron") return { app: fakeApp };
  if (["node:path", "node:crypto", "./single-instance.cjs"].includes(name)) return require(name);
  assert.fail(`losing instance loaded ${name}`);
}, { env: {} });
assert.equal(requested, true);
assert.equal(exited, 0);
assert.ok(main.indexOf('app.setPath("userData"') < main.indexOf("acquireDesktopInstance(app)"));
assert.ok(main.indexOf("acquireDesktopInstance(app)") < main.indexOf('require("electron-updater")'));
assert.match(main, /desktopInstance\.windowReady\(mainWindow\)/);
const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
assert.ok(pkg.build.files.includes("single-instance.cjs"));
console.log("desktop single instance tests passed");
