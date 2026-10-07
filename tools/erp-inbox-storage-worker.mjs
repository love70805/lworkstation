import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {parentPort, workerData} from 'node:worker_threads';

const signature = stats => `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
async function read(file) {
  try {
    for(let attempt=0;attempt<3;attempt++) {
      const before=signature(await fs.stat(file));
      const records = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(records)) throw Object.assign(new Error('ERP 收件文件格式无效，请保留原件并恢复备份。'), {code:'ERP_INBOX_CORRUPT'});
      const after=signature(await fs.stat(file));
      if(before===after)return {records, revision:after};
    }
    throw Object.assign(new Error('ERP 收件文件正在被其他进程修改，请稍后重试。'),{code:'ERP_INBOX_SPOOL_CHANGED'});
  } catch(error) {
    if(error.code === 'ENOENT') return {records:[], revision:'missing'};
    throw error;
  }
}

async function write(file, records) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let owned = false;
  try {
    const handle = await fs.open(temporary, 'wx');
    owned = true;
    try {
      // Both serialization and fsync run off the HTTP event loop.
      await handle.writeFile(JSON.stringify(records), 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    for(let attempt=0;;attempt++) {
      try { await fs.rename(temporary, file); break; }
      catch(error) {
        if(!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await new Promise(resolve=>setTimeout(resolve, 20*2**attempt));
      }
    }
    return {revision:signature(await fs.stat(file))};
  } finally {
    if(owned) await fs.rm(temporary, {force:true}).catch(()=>{});
  }
}

try {
  const result = workerData.operation === 'read' ? await read(workerData.file)
    : workerData.operation === 'write' ? await write(workerData.file, workerData.records)
    : (()=>{throw new Error('Unsupported inbox storage operation');})();
  parentPort.postMessage({ok:true, ...result});
} catch(error) { parentPort.postMessage({ok:false,error:{message:error.message,code:error.code}}); }
finally { parentPort.close(); }
