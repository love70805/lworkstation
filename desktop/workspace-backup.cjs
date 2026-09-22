const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateBackupRequest(input) {
  if (!input || typeof input.json !== 'string' || typeof input.fileName !== 'string'
    || !/^[\p{L}\p{N}_. -]+\.json$/u.test(input.fileName) || input.fileName.length > 160
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(input.fileName)) throw Error('备份保存请求无效。');
  const sizeBytes = Buffer.byteLength(input.json, 'utf8');
  if (sizeBytes > 512 * 1024 * 1024) throw Error('备份超过单文件保存上限（512 MB）。');
  const payload = JSON.parse(input.json);
  if (!['shopeers-local-backup', 'shopeers-cloud-seed'].includes(payload?.format)
    || payload.formatVersion !== 1 || !payload.tables || typeof payload.tables !== 'object'
    || Array.isArray(payload.tables)) throw Error('只能保存 Lworkstation JSON 备份或种子包。');
  return { fileName: input.fileName, json: input.json, sizeBytes };
}

function createBackupSaver({ showSaveDialog, operations = fs, isTrusted = () => true }) {
  let saving = false;
  return async function saveBackup(input) {
    if (saving) return { status: 'failed', error: '已有备份正在保存，请完成后再试。' };
    if (!isTrusted()) return { status: 'failed', error: '无效的工作站请求。' };
    saving = true;
    let stagingPath;
    let handle;
    try {
      const backup = validateBackupRequest(input);
      const selected = await showSaveDialog({
        title: '保存 Lworkstation 备份', defaultPath: backup.fileName,
        filters: [{ name: 'JSON 备份', extensions: ['json'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (selected.canceled || !selected.filePath) return { status: 'canceled' };
      if (!isTrusted()) throw Error('工作站已离开当前页面，未保存备份。');
      const target = path.resolve(selected.filePath);
      if (path.extname(target).toLowerCase() !== '.json') throw Error('请使用 .json 扩展名保存备份。');
      stagingPath = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
      handle = await operations.open(stagingPath, 'wx', 0o600);
      await handle.writeFile(backup.json, 'utf8');
      await handle.sync();
      const stat = await handle.stat();
      if (stat.size !== backup.sizeBytes) throw Error('备份文件未完整写入。');
      await handle.close();
      handle = null;
      await operations.rename(stagingPath, target);
      stagingPath = null;
      return { status: 'saved', fileName: path.basename(target), sizeBytes: backup.sizeBytes };
    } catch (error) {
      return { status: 'failed', error: `备份未保存：${error.message}` };
    } finally {
      try { await handle?.close(); } catch {}
      if (stagingPath) { try { await operations.unlink(stagingPath); } catch {} }
      saving = false;
    }
  };
}

module.exports = { createBackupSaver, validateBackupRequest };
