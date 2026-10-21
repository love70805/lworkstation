import {Worker} from 'node:worker_threads';
import {inboxDiskRevision} from './erp-inbox-disk.mjs';

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

export function createInboxStorage(file,options={}) {
  let snapshot=null,revision=null,loading=null,writing=false;
  let worker=null,sequence=0,evidenceSequence=0,evidenceIds=new WeakMap(),committedSignature=null;
  let writeChain=Promise.resolve();
  const pending=new Map();
  function operation(action, payload={}) {
    if(!worker) {
      committedSignature=null;
      const current=new Worker(new URL('./erp-inbox-storage-worker.mjs',import.meta.url),{workerData:{file,options}});
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
    return inboxDiskRevision(file);
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
      if(current==='missing|missing' && !worker) {
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
    if(!snapshot)await read();
    if(!worker)await operation('read');
    const additions=[],entries=entriesFor(records,additions),signature=JSON.stringify(entries);
    if(!additions.length && signature===committedSignature && await fileRevision()===revision)return;
    writing=true;
    try {
      // Immutable historical envelopes remain in the worker. A task/acknowledgement
      // sends only metadata; a newly delivered envelope is transferred once.
      const result=await operation('write',{entries,additions,expectedRevision:revision});
      snapshot=records.map((record,index)=>{
        const envelope=result.previews[index]??record.envelope;
        if(record.envelope && typeof record.envelope==='object')evidenceIds.set(record.envelope,result.envelopeIds[index]);
        if(envelope && typeof envelope==='object')evidenceIds.set(envelope,result.envelopeIds[index]);
        return envelope===record.envelope?record:{...record,envelope};
      });
      seal(snapshot);revision=result.revision;
      committedSignature=JSON.stringify(entriesFor(snapshot,[]));
    } finally {writing=false;}
  }
  function write(records) {
    const result=writeChain.catch(()=>{}).then(()=>writeNow(records));
    writeChain=result;return result;
  }
  async function hydrate(record) {
    if(!record?.envelope?.__inboxArchive)return record;
    const envelopeId=evidenceIds.get(record.envelope);
    // Cached previews outlive a failed worker; rebuild its reference index
    // before the first on-demand read in the replacement worker.
    if(!worker)await operation('read');
    const result=await operation('hydrate',{envelopeId});
    return {...record,envelope:result.envelope};
  }
  async function exportRecords() {
    await writeChain;
    const result=await operation('snapshot');
    return result.records;
  }
  function reset(records) {
    const result=writeChain.catch(()=>{}).then(async()=>{
      if(loading)await loading;
      if(!snapshot)await read();
      if(records.some(record=>record.envelope!==undefined))throw new Error('清空后的运行状态不能包含业务证据。');
      writing=true;
      try {
        const receipt=await operation('reset',{records,expectedRevision:revision});
        snapshot=records;revision=receipt.revision;evidenceIds=new WeakMap();
        committedSignature=JSON.stringify(entriesFor(snapshot,[]));
      }catch(error){snapshot=null;revision=null;committedSignature=null;throw error;}
      finally{writing=false;}
    });
    writeChain=result;return result;
  }
  return {read,write,reset,hydrate,exportRecords};
}
