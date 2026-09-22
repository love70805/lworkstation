import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createBackupSaver } = require('./workspace-backup.cjs');
const { registerWorkspaceSystemIpc } = require('./workspace-system-ipc.cjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lworkstation-backup-test-'));
const target = path.join(root, 'backup.json');
const input = { fileName: 'backup.json', json: JSON.stringify({ format: 'shopeers-local-backup', formatVersion: 1, tables: { products: [{ title: '合成商品' }] } }) };
try {
  const save = createBackupSaver({ showSaveDialog: async () => ({ filePath: target, canceled: false }) });
  const saved = await save(input);
  assert.deepEqual(saved, { status: 'saved', fileName: 'backup.json', sizeBytes: Buffer.byteLength(input.json) });
  assert.equal(await fs.readFile(target, 'utf8'), input.json);
  const canceled = createBackupSaver({ showSaveDialog: async () => ({ canceled: true }) });
  assert.deepEqual(await canceled(input), { status: 'canceled' });
  const broken = createBackupSaver({ showSaveDialog: async () => ({ filePath: target }), operations: {
    ...fs, open: async () => { throw Error('ENOSPC: fixture disk full'); },
  } });
  assert.match((await broken(input)).error, /ENOSPC/);
  assert.equal(await fs.readFile(target, 'utf8'), input.json, 'failed save preserves existing target');
  const failedSync = createBackupSaver({ showSaveDialog: async () => ({ filePath: target }), operations: {
    ...fs, open: async (...args) => {
      const handle = await fs.open(...args);
      return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(), sync: async () => { throw Error('fixture sync failed'); } };
    },
  } });
  assert.equal((await failedSync(input)).status, 'failed');
  assert.deepEqual(await fs.readdir(root), ['backup.json'], 'failed temporary files are removed');
  assert.equal(await fs.readFile(target, 'utf8'), input.json);
  for (const invalid of [{ ...input, fileName: '../outside.json' }, { ...input, json: '{}' }, { ...input, fileName: 'con.json' }]) {
    assert.equal((await save(invalid)).status, 'failed');
  }

  const handlers = new Map();
  let dialogCalls = 0;
  let closeBehavior = 'tray';
  const contents = { isDestroyed: () => false, mainFrame: { url: 'shopeers://workstation/data-security' } };
  registerWorkspaceSystemIpc({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getContents: () => contents, getWindow: () => ({}),
    dialog: { showSaveDialog: async () => { dialogCalls++; return { canceled: true }; } },
    getLifecycle: () => ({ getState: () => ({ closeBehavior, trayAvailable: true }), setCloseBehavior: value => {
      if (!['tray', 'quit'].includes(value)) throw Error('invalid behavior');
      closeBehavior = value;
    } }),
  });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  for (const untrusted of [{ sender: {}, senderFrame: contents.mainFrame }, { sender: contents, senderFrame: { url: contents.mainFrame.url } }]) {
    assert.equal((await handlers.get('workspace:save-backup')(untrusted, input)).status, 'failed');
    assert.equal(handlers.get('workspace:set-close-behavior')(untrusted, 'quit').ok, false);
  }
  contents.mainFrame.url = 'https://www.1688.com/';
  assert.equal((await handlers.get('workspace:save-backup')(event, input)).status, 'failed');
  assert.equal(dialogCalls, 0, 'untrusted senders never open a native dialog');
  contents.mainFrame.url = 'shopeers://workstation/diagnostics';
  assert.equal((await handlers.get('workspace:save-backup')(event, input)).status, 'canceled');
  assert.equal(handlers.get('workspace:get-close-behavior')(event).closeBehavior, 'tray');
  assert.equal(handlers.get('workspace:set-close-behavior')(event, 'quit').closeBehavior, 'quit');
  assert.equal(handlers.get('workspace:set-close-behavior')(event, 'invalid').ok, false);
  assert.equal(closeBehavior, 'quit');

  let trusted = true;
  const navigated = createBackupSaver({ isTrusted: () => trusted, showSaveDialog: async () => {
    trusted = false; return { filePath: path.join(root, 'should-not-exist.json') };
  } });
  assert.equal((await navigated(input)).status, 'failed');
  assert.deepEqual(await fs.readdir(root), ['backup.json']);
  console.log('workspace system: saved/canceled/write failure/sync failure, atomic target protection, sender/frame/origin and close preference checks passed');
} finally {
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(root, { recursive: true, force: true });
}
