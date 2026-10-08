import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createRemoteViewLoader } = createRequire(import.meta.url)('./remote-view-loader.cjs');
const views = new Map();
let resolve, fail = false, builds = 0, alive = true;
const loader = createRemoteViewLoader({
  getView: id => views.get(id), canCreate: () => alive,
  discard: id => views.delete(id),
  build: async id => {
    builds++;
    const view = { webContents: { isDestroyed: () => false }, id };
    views.set(id, view);
    await new Promise(done => { resolve = done; });
    if (fail) throw new Error('extension unavailable');
    return view;
  },
});
const first = loader.ensure('erp');
await Promise.resolve();
const concurrent = loader.ensure('erp');
assert.equal(concurrent, first, 'a partially created view cannot bypass initialization');
resolve();
assert.equal((await first).id, 'erp');
assert.equal(await concurrent, await loader.ensure('erp'));
assert.equal(builds, 1, 'opened pages and their background work stay alive');
fail = true;
const failure = loader.ensure('1688');
await Promise.resolve(); resolve();
await assert.rejects(failure, /extension unavailable/);
assert.equal(views.has('1688'), false);
fail = false;
const retry = loader.ensure('1688');
await Promise.resolve(); resolve();
assert.equal((await retry).id, '1688');
assert.equal(builds, 3, 'a failed initialization releases the promise for retry');
const exiting = loader.ensure('late');
await Promise.resolve(); loader.stop(); resolve();
await assert.rejects(exiting, /退出/);
assert.equal(views.has('late'), false, 'late completion cannot leave a page after shutdown');
await assert.rejects(loader.ensure('erp'), /退出/);
assert.equal(builds, 4);
alive = false;
console.log('Lazy remote view concurrent initialization, retry, retention and shutdown tests passed.');
