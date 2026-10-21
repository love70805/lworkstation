import {parentPort,workerData} from 'node:worker_threads';
import {createInboxDisk,inboxEvidencePreview} from './erp-inbox-disk.mjs';

const disk=createInboxDisk(workerData.file,workerData.options);
let evidence=new Map(),operations=Promise.resolve();
const cold = metadata => workerData.options?.coldAcknowledged && ['batch','catalog-batch','selection-capture'].includes(metadata.kind) && metadata.status==='acknowledged';
async function recordsFor(entries,all=false) {
  const records=[];
  for(const entry of entries) {
    records.push({...entry.metadata,...(entry.ref===undefined?{}:{envelope:!all&&cold(entry.metadata)&&entry.preview?entry.preview:await disk.evidence(entry.ref)})});
  }
  return records;
}
parentPort.on('message',message=>{
  operations=operations.catch(()=>{}).then(async()=>{
    try {
      let result;
      if(message.action==='read'||message.action==='snapshot') {
        const entries=await disk.load();
        evidence=new Map(entries.filter(e=>e.ref!==undefined).map(e=>[e.ref,{ref:e.ref,preview:e.preview}]));
        result={records:await recordsFor(entries,message.action==='snapshot'),envelopeIds:entries.map(e=>e.ref??null),revision:disk.revision};
      } else if(message.action==='reset') {
        result=await disk.reset(message.records.map(metadata=>({metadata})),message.expectedRevision);
        evidence.clear();
      } else if(message.action==='hydrate') {
        const entry=evidence.get(message.envelopeId);
        if(!entry)throw Object.assign(new Error('ERP 原始证据引用已失效，请重新读取。'),{code:'ERP_INBOX_EVIDENCE_MISSING'});
        result={envelope:await disk.evidence(entry.ref)};
      } else if(message.action==='write') {
        const next=new Map(evidence);
        for(const item of message.additions)next.set(item.envelopeId,{ref:await disk.saveEvidence(item.envelope),preview:inboxEvidencePreview(item.envelope)});
        const entries=message.entries.map(({metadata,envelopeId})=>{
          if(envelopeId===undefined)return {metadata};
          const entry=next.get(envelopeId);
          if(!entry)throw Object.assign(new Error('ERP 原始证据缓存已失效，请重新读取。'),{code:'ERP_INBOX_EVIDENCE_MISSING'});
          return {metadata,...entry};
        });
        result=await disk.write(entries,message.expectedRevision);
        evidence=new Map(entries.filter(e=>e.ref!==undefined).map(e=>[e.ref,{ref:e.ref,preview:e.preview}]));
        result.envelopeIds=entries.map(e=>e.ref??null);
        result.previews=entries.map(e=>cold(e.metadata)?e.preview:null);
      } else throw new Error('Unsupported inbox storage operation');
      parentPort.postMessage({id:message.id,ok:true,...result});
    } catch(error){parentPort.postMessage({id:message.id,ok:false,error:{message:error.message,code:error.code}});}
  });
});
