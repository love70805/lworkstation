import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const element = () => ({ dataset: {}, style: {}, hidden: false, disabled: false, scrollHeight: 300, addEventListener() {}, focus() {} });
const actions = ['check', 'download', 'cancel', 'retry', 'install', 'postpone'].map(name => ({ ...element(), dataset: { updateAction: name } }));
const elements = new Map();
let onState;
let resolveDownload;
let downloads = 0;
let cancels = 0;
const base = { currentVersion: '0.3.0-beta.4', availableVersion: '0.3.0-beta.5' };
const state = update => ({ update: { ...base, ...update } });
const context = vm.createContext({
  console, Intl, Math, Number, Date, parseFloat,
  getComputedStyle: () => ({ borderTopWidth: '1', borderBottomWidth: '1' }),
  document: {
    querySelector: selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
    querySelectorAll: () => actions, documentElement: { dataset: {} }, addEventListener() {},
  },
  window: { addEventListener() {}, updatePopover: {
    resize() {}, onState: callback => { onState = callback; }, getState: async () => state({ status: 'available' }),
    download: () => { downloads++; onState(state({ status: 'downloading' })); return new Promise(resolve => { resolveDownload = resolve; }); },
    cancel: async () => { cancels++; onState(state({ status: 'canceled', retryAction: 'download' })); resolveDownload({ ok: false, canceled: true }); return { ok: true }; },
  } },
});
vm.runInContext(fs.readFileSync(new URL('./update-popover.js', import.meta.url), 'utf8'), context);
await Promise.resolve();
const pending = vm.runInContext("runAction('download')", context);
const cancel = actions.find(action => action.dataset.updateAction === 'cancel');
assert.equal(cancel.hidden, false);
assert.equal(cancel.disabled, false, 'cancel stays interactive while the download Promise is pending');
await vm.runInContext("runAction('download')", context);
assert.equal(downloads, 1, 'download cannot be started twice');
await vm.runInContext("runAction('cancel')", context);
await pending;
assert.equal(cancels, 1);
assert.equal(actions.find(action => action.dataset.updateAction === 'retry').disabled, false);
const retry = vm.runInContext("runAction('retry')", context);
assert.equal(downloads, 2);
assert.equal(cancel.disabled, false);
onState(state({ status: 'downloaded' }));
resolveDownload({ ok: true });
await retry;
assert.equal(actions.find(action => action.dataset.updateAction === 'install').disabled, false);
console.log('update popover: pending download cancellation, duplicate guard, retry and install readiness passed');
