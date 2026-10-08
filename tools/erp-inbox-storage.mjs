import fs from 'node:fs/promises';
import {Worker} from 'node:worker_threads';

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
  let worker=null,sequence=0,evidenceSequence=0,evidenceIds=new WeakMap(),committedSignature=null;
  let writeChain=Promise.resolve();
  const pending=new Map();
  function operation(action, payload={}) {
    if(!worker) {
      evidenceIds=new WeakMap();committedSignature=null;
      const current=new Worker(new URL('./erp-inbox-storage-worker.mjs',import.meta.url),{workerData:{file}});
      worker=current;
      const fail=error=>{
        if(worker!==current)return;
        worker=null;
        for(const request of pending.values())request.reject(error);
        pending.clear();
      };
      current.on('message',result=>{
        const request=pending.get(result.id);
        if(!request)return;
        pending.delete(result.id);
        if(!pending.size)current.unref();
        if(result.ok)request.resolve(result);
        else request.reject(Object.assign(new Error(result.error?.message || 'ERP 收件文件读写失败。'),{code:result.error?.code}));
      });
      current.once('error',fail);
      current.once('exit',code=>fail(Object.assign(new Error(`ERP 收件存储进程退出：${code}`),{code:'ERP_INBOX_STORAGE_EXIT'})));
    }
    const current=worker,id=++sequence;
    return new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});current.ref();
      try {current.postMessage({id,action,...payload});}
      catch(error){pending.delete(id);if(!pending.size)current.unref();reject(error);}
    });
  }
  function entriesFor(records, additions) {
    const newIds=new WeakMap();
    return records.map(record=>{
      const {envelope,...metadata}=record;
      if(envelope===undefined)return {metadata};
      const object=envelope && typeof envelope==='object';
      let envelopeId=object ? evidenceIds.get(envelope)||newIds.get(envelope) : null;
      if(!envelopeId) {
        envelopeId=`new-${++evidenceSequence}`;
        if(object)newIds.set(envelope,envelopeId);
        additions.push({envelopeId,envelope});
      }
      return {metadata,envelopeId};
    });
  }
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
      // Fresh profiles and unused lease queues have no file to parse. Do not
      // keep a storage isolate alive just to cache an empty array. A later
      // first write or externally created file still takes the worker path.
      if(current==='missing' && !worker) {
        snapshot=[];revision=current;committedSignature='[]';
        return snapshot;
      }
      const result=await operation('read');
      evidenceIds=new WeakMap();
      result.records.forEach((record,index)=>{
        if(record.envelope && typeof record.envelope==='object')evidenceIds.set(record.envelope,result.envelopeIds[index]);
      });
      snapshot=seal(result.records);revision=result.revision;
      committedSignature=JSON.stringify(entriesFor(snapshot,[]));
      return snapshot;
    })();
    try{return await loading;}finally{loading=null;}
  }
  async function writeNow(records) {
    if(loading) await loading;
    // Start the worker before resolving references: a replacement worker has
    // no cached evidence and must receive it again after a process failure.
    if(!worker)await operation('read');
    const additions=[],entries=entriesFor(records,additions),signature=JSON.stringify(entries);
    if(!additions.length && signature===committedSignature && await fileRevision()===revision)return;
    writing=true;
    try {
      // Immutable historical envelopes remain in the worker. A task/acknowledgement
      // sends only metadata; a newly delivered envelope is transferred once.
      const result=await operation('write',{entries,additions});
      additions.forEach(({envelopeId,envelope})=>{
        if(envelope && typeof envelope==='object')evidenceIds.set(envelope,envelopeId);
      });
      snapshot=seal(records);revision=result.revision;
      committedSignature=signature;
    } finally {writing=false;}
  }
  function write(records) {
    const result=writeChain.catch(()=>{}).then(()=>writeNow(records));
    writeChain=result;return result;
  }
  return {read,write};
}
