const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

// Stable NSIS identity, shared by all existing per-user and per-machine installs.
const INSTALL_GUID = 'b871a797-4186-59e7-b82d-5dde992706b7';
const registryQuery = promisify(execFile);
const sameDirectory = (left, right) => typeof left === 'string' && left.trim()
  && path.win32.resolve(left.trim()).toLowerCase() === path.win32.resolve(right).toLowerCase();

async function readInstallLocation(hive) {
  for (const view of ['64', '32']) {
    try {
      const { stdout } = await registryQuery(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
        ['query', `${hive}\\Software\\${INSTALL_GUID}`, '/v', 'InstallLocation', `/reg:${view}`],
        { windowsHide: true, timeout: 5000, encoding: 'utf8' });
      const location = stdout.match(/InstallLocation\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
      if (location) return location;
    } catch (error) {
      // reg.exe returns 1 for an absent key. Other failures must not select a scope.
      if (error.code !== 1) throw Object.assign(new Error('无法读取本机安装范围，请重试或手动运行已下载的安装包。'), { code: 'REGISTRY' });
    }
  }
  return null;
}

async function resolveInstallScope(directory, readLocation = readInstallLocation) {
  const [machine, user] = await Promise.all([readLocation('HKLM'), readLocation('HKCU')]);
  if (sameDirectory(machine, directory)) return 'machine';
  if (sameDirectory(user, directory)) return 'user';
  throw Object.assign(new Error('当前程序与 Windows 安装登记目录不一致，请手动运行安装包修复安装。'), { code: 'INSTALL_SCOPE' });
}

function installError(code) {
  if (String(code) === '1223') return '已取消管理员授权，尚未安装。当前版本仍可使用，可点击重试。';
  if (['5', '6710886', 'EXIT_6710886', 'EACCES', 'EPERM'].includes(String(code))) return '安装权限不足，尚未安装。请允许管理员授权后重试。';
  if (code === 'ENOENT') return '已下载的安装文件不可用，请重新检查并下载更新。';
  if (code === 'TIMEOUT') return '安装器尚未就绪，当前版本仍可使用。请检查管理员授权窗口后重试。';
  return `安装器未能启动（${/^[A-Z0-9_-]{1,24}$/.test(String(code)) ? code : 'UNKNOWN'}），当前版本仍可使用，请重试。`;
}

function createUpdateInstaller({ executable, userDataPath, parentPid = process.pid, resolveScope = resolveInstallScope,
  spawnInstaller = spawn, createServer = net.createServer, timeoutMs = 120000, record: recordOverride } = {}) {
  let pending = null;
  const logPath = path.join(userDataPath, 'runtime', 'update-install.jsonl');
  function record(stage, details = {}) {
    const entry = { at: new Date().toISOString(), stage, ...details };
    if (recordOverride) { recordOverride(entry); return; }
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 65536) fs.renameSync(logPath, logPath + '.previous');
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch (_) { /* Logging failure must not prevent a safe install or hide its UI error. */ }
  }
  async function prepare(updater, onWaiting = () => {}) {
    const helper = updater.downloadedUpdateHelper;
    const file = helper?.file;
    const expected = helper?.downloadedFileInfo?.sha512;
    const version = helper?.versionInfo?.version;
    record('prepare', { version });
    if (!file || !/\.exe$/i.test(file) || !expected) throw Object.assign(new Error(installError('ENOENT')), { code: 'ENOENT' });
    const actual = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha512');
      fs.createReadStream(file).on('error', reject).on('data', data => hash.update(data)).on('end', () => resolve(hash.digest('base64')));
    });
    if (actual !== expected) throw Object.assign(new Error('安装包校验失败，尚未安装。请重新下载更新。'), { code: 'CHECKSUM' });
    const directory = path.dirname(executable);
    const scope = await resolveScope(directory);
    record('launch', { version, scope });
    onWaiting(scope);
    const pipe = `\\\\.\\pipe\\Lworkstation.Update.${crypto.randomBytes(16).toString('hex')}`;
    return new Promise((resolve, reject) => {
      let settled = false, child, timer;
      const sockets = new Set();
      const server = createServer(socket => {
        sockets.add(socket);
        let input = '';
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
        socket.on('data', data => {
          input += data.toString('utf8');
          if (input.length > 80) { socket.destroy(); return; }
          const line = input.split('\n')[0].trim();
          if (!input.includes('\n')) return;
          if (line === 'ready') finish(null);
          else if (/^error:[A-Z0-9_-]+$/.test(line)) finish(line.slice(6));
        });
      });
      function finish(code) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        for (const socket of sockets) socket.destroy();
        server.close();
        if (code) {
          record('failed', { version, scope, code: String(code) });
          reject(Object.assign(new Error(installError(code)), { code }));
        } else {
          record('installer-ready', { version, scope });
          resolve({ ok: true, version, scope });
        }
      }
      server.once('error', error => finish(error.code || 'PIPE'));
      server.listen(pipe, () => {
        timer = setTimeout(() => finish('TIMEOUT'), timeoutMs);
        try {
          // /D must be last: NSIS reads the complete remainder as the directory.
          const args = ['--updated', '--force-run', scope === 'machine' ? '/allusers' : '/currentuser',
            `--lworkstation-pipe=${pipe}`, `--lworkstation-parent=${parentPid}`, `/D=${directory}`];
          // This is an assisted installer, not a background helper: keep its
          // progress and Finish page visible after the workbench exits.
          child = spawnInstaller(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
          child.once('error', error => finish(error.code || 'SPAWN'));
          child.once('exit', code => finish(code === 1223 ? '1223' : `EXIT_${code ?? 'UNKNOWN'}`));
          child.unref();
        } catch (error) { finish(error.code || 'SPAWN'); }
      });
    });
  }
  return {
    prepare(updater, onWaiting) {
      if (pending) return pending;
      pending = prepare(updater, onWaiting).catch(error => {
        record('rejected', { code: String(error.code || 'UNKNOWN') });
        if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) error = Object.assign(new Error(installError(error.code)), { code: error.code });
        throw error;
      }).finally(() => { pending = null; });
      return pending;
    },
    record,
  };
}
module.exports = { INSTALL_GUID, sameDirectory, resolveInstallScope, installError, createUpdateInstaller };
