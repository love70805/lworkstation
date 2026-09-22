import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createDesktopLifecycle, createStartupState } = require('./desktop-lifecycle.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-lifecycle-test-'));
try {
  for (const unavailable of [false, true]) {
    let tray; let visible = true; let quits = 0;
    const app = Object.assign(new EventEmitter(), { quit: () => { app.emit('before-quit'); quits++; } });
    const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, isMinimized: () => false, show: () => { visible = true; }, focus() {}, hide: () => { visible = false; } });
    class Tray extends EventEmitter {
      constructor() { super(); if (unavailable) throw new Error('unavailable'); tray = this; }
      setToolTip(value) { this.tooltip = value; } setContextMenu(value) { this.menu = value; } isDestroyed() { return this.dead; } destroy() { this.dead = true; } displayBalloon() {}
    }
    const lifecycle = createDesktopLifecycle({ app, window, Tray, Menu: { buildFromTemplate: value => value }, userDataPath: path.join(root, String(unavailable)) });
    let prevented = false;
    window.emit('close', { preventDefault: () => { prevented = true; } });
    assert.equal(prevented, !unavailable); assert.equal(visible, unavailable);
    if (tray) {
      tray.emit('click'); assert(visible);
      tray.menu[2].submenu[1].click(); assert.equal(lifecycle.getState().closeBehavior, 'quit');
      assert.match(tray.tooltip, /退出应用/);
      lifecycle.setCloseBehavior('tray'); assert.match(tray.tooltip, /继续后台收件/);
      assert.equal(tray.menu[2].submenu[0].checked, true);
      assert.throws(() => lifecycle.setCloseBehavior('invalid'));
      assert.equal(lifecycle.getState().closeBehavior, 'tray');
    }
    lifecycle.quit(); assert.equal(quits, 1);
    prevented = false; window.emit('close', { preventDefault: () => { prevented = true; } }); assert(!prevented);
    lifecycle.dispose();
  }
  const startup = createStartupState({ changed() {}, timeoutMs: 10 });
  startup.start(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(startup.getState().status, 'error');
  startup.start(); startup.ready(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(startup.getState().status, 'ready');
  startup.dispose();
  console.log('desktop lifecycle tests passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
