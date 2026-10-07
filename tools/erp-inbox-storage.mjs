import fs from 'node:fs/promises';
import {Worker} from 'node:worker_threads';

function operation(file, action, records) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./erp-inbox-storage-worker.mjs',import.meta.url), {workerData:{file,operation:action,records}});
    let settled = false;
    worker.once('message', result=>{
      settled = true;
      if(result.ok) resolve(result);
      else reject(Object.assign(new Error(result.error?.message || 'ERP 收件文件读写失败。'), {code:result.error?.code}));
    });
    worker.once('error', error=>{settled=true;reject(error);});
    worker.once('exit', code=>{if(!settled) reject(Object.assign(new Error(`ERP 收件存储进程退出：${code}`),{code:'ERP_INBOX_STORAGE_EXIT'}));});
  });
}

function freezeEvidence(value) {
  if(!value || typeof value!=='object' || Object.isFrozen(value)) return value;
  for(const child of Object.values(value)) freezeEvidence(child);
  return Object.freeze(value);
}
function seal(records) {
  for(const record of records) if(record.envelope) freezeEvidence(record.envelope);
  return records;
}
export function cloneInboxMetadata(records) {
  return records.map(record=>{
    const {envelope,...metadata}=record;
    return {...structuredClone(metadata),...(envelope===undefined?{}:{envelope})};
  });
}

export function createInboxStorage(file) {
  let snapshot=null,revision=null,loading=null,writing=false;
  async function fileRevision() {
    try {const stats=await fs.stat(file);return `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;}
    catch(error){if(error.code==='ENOENT')return 'missing';throw error;}
  }
  async function read() {
    // Readers see the last fully committed snapshot while a write is pending.
    if(writing && snapshot) return snapshot;
    if(loading) return loading;
    loading=(async()=>{
      const current=await fileRevision();
      if(snapshot && current===revision) return snapshot;
      const result=await operation(file,'read');
      snapshot=seal(result.records);revision=result.revision;
      return snapshot;
    })();
    try{return await loading;}finally{loading=null;}
  }
  async function write(records) {
    if(loading) await loading;
    writing=true;
    try {
      const result=await operation(file,'write',records);
      snapshot=seal(records);revision=result.revision;
    } finally {writing=false;}
  }
  return {read,write};
}
