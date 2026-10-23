import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { INSTALL_GUID, resolveInstallScope, sameDirectory, createUpdateInstaller } = createRequire(import.meta.url)('./update-install.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-install-contract-'));
const file = path.join(root, 'update.exe');
fs.writeFileSync(file, 'synthetic verified installer');
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
const updater = { downloadedUpdateHelper: { file, downloadedFileInfo: { sha512, isAdminRightsRequired: false }, versionInfo: { version: '1.0.0-rc.4' } } };
const installed = 'C:\\Program Files\\Lworkstation';
assert.equal(INSTALL_GUID, JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url))).build.nsis.guid);
assert.ok(sameDirectory('c:\\program files\\LWORKSTATION\\', installed));
assert.equal(await resolveInstallScope(installed, async hive => hive === 'HKLM' ? installed : 'C:\\other'), 'machine');
assert.equal(await resolveInstallScope(installed, async hive => hive === 'HKCU' ? installed : null), 'user');
await assert.rejects(resolveInstallScope(installed, async () => null), { code: 'INSTALL_SCOPE' });
let calls = 0, mode = 'denied', records = [], lastArgs;
const options = { executable: path.join(root, 'Lworkstation.exe'), userDataPath: root, timeoutMs: 500,
  resolveScope: async () => 'machine', record: entry => records.push(entry),
  spawnInstaller(exe, args, spawnOptions) {
    calls++; lastArgs = args;
    assert.equal(exe, file); assert.equal(spawnOptions.windowsHide, false, 'assisted installer must remain visible');
    const child = new EventEmitter(); child.unref = () => {};
    if (mode === 'spawn-failed') { setImmediate(() => child.emit('error', Object.assign(new Error('private path'), { code: 'EACCES' }))); return child; }
    if (mode === 'timeout') return child;
    const pipe = args.find(arg => arg.startsWith('--lworkstation-pipe=')).split('=').slice(1).join('=');
    const socket = net.connect(pipe, () => socket.end(mode === 'denied' ? 'error:1223\n' : 'ready\n'));
    socket.on('error', () => {});
    return child;
  },
};
try {
  const installer = createUpdateInstaller(options);
  const first = installer.prepare(updater);
  const duplicate = installer.prepare(updater);
  assert.equal(first, duplicate, 'duplicate clicks share one launch');
  await assert.rejects(first, error => error.code === '1223' && /取消管理员授权/.test(error.message));
  assert.equal(calls, 1);
  assert.ok(lastArgs.includes('/allusers'), 'installed scope overrides false feed admin metadata');
  assert.ok(lastArgs.at(-1).startsWith('/D='));
  mode = 'ready';
  assert.deepEqual(await installer.prepare(updater), { ok: true, version: '1.0.0-rc.4', scope: 'machine' });
  mode = 'spawn-failed';
  await assert.rejects(installer.prepare(updater), error => error.code === 'EACCES' && /权限不足/.test(error.message));
  mode = 'timeout';
  await assert.rejects(installer.prepare(updater), { code: 'TIMEOUT' });
  fs.writeFileSync(file, 'modified');
  const before = calls;
  await assert.rejects(installer.prepare(updater), { code: 'CHECKSUM' });
  assert.equal(calls, before, 'tampered file must never start');
  assert.ok(records.some(entry => entry.stage === 'installer-ready'));
  assert.ok(records.every(entry => !JSON.stringify(entry).includes(root)), 'logs omit local paths');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('update install: installed scope, checksum, native pipe acknowledgment, authorization cancellation, retry, duplicate guard, spawn failure and timeout passed');
