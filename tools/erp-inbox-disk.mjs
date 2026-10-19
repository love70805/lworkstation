import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FORMAT = 'lworkstation-inbox-index';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const corrupt = message => Object.assign(new Error(`ERP 收件存储损坏：${message}。请保留原件并恢复备份。`), {code:'ERP_INBOX_CORRUPT'});
const statSignature = value => `${value.size}:${value.mtimeMs}:${value.ctimeMs}:${value.ino}`;
export function inboxEvidencePreview(envelope) {
  const batch=envelope?.batch??{};
  const sourceFormatVersion=Number(envelope?.sourceFormatVersion??batch.sourceFormatVersion??envelope?.formatVersion??batch.formatVersion)===1?1:2;
  const rows=Array.isArray(batch.warehouseEvidence)?batch.warehouseEvidence:[];
  const evidenceStatus=sourceFormatVersion===1||batch.sourceMeta?.evidenceComplete===false||(Array.isArray(batch.sourceMeta?.sourceWarnings)&&batch.sourceMeta.sourceWarnings.length)?'legacy_partial'
    : ['complete','legacy_partial'].includes(batch.evidenceStatus)?batch.evidenceStatus
    : rows.length&&rows.every(row=>row?.evidenceComplete===true)?'complete':'legacy_partial';
  const catalog=envelope?.catalog;
  return {__inboxArchive:{sourceFormatVersion,batchFormatVersion:Number(batch.formatVersion)||null,evidenceStatus,warehouseEvidenceCount:rows.length,rowCount:Array.isArray(batch.rows)?batch.rows.length:0},
    ...(envelope?.type?{type:envelope.type}:{}),
    ...(catalog?{catalog:Object.fromEntries(['requestId','workspaceId','ledgerPeriod','ledgerId','generatedAt','query','coverage'].filter(key=>catalog[key]!==undefined).map(key=>[key,catalog[key]]))}:{})};
}
async function stat(file) { try { return statSignature(await fs.stat(file)); } catch (e) { if(e.code==='ENOENT')return 'missing'; throw e; } }
export async function inboxDiskRevision(file) { return `${await stat(file)}|${await stat(`${file}.journal`)}`; }

async function replace(file, text) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    for(let attempt=0;;attempt++) {
      try { await fs.rename(temporary,file); break; }
      catch(e) { if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=5)throw e; await new Promise(r=>setTimeout(r,20*2**attempt)); }
    }
  } finally { await fs.rm(temporary,{force:true}).catch(()=>{}); }
}

// Only metadata is checkpointed. Immutable evidence is written once by content hash.
// No retention rule deletes original purchase evidence, including after a reset.
export function createInboxDisk(file, {checkpointBytes=512*1024, checkpointOperations=64}={}) {
  const blobs = `${file}.evidence`, log = `${file}.journal`;
  let state, revision, validLogBytes=0, operations=0, legacyText;
  const blobPath = ref => {
    if(!/^[a-f0-9]{64}$/.test(ref))throw corrupt('证据引用无效');
    return path.join(blobs,`${ref}.json`);
  };
  async function saveEvidence(envelope) {
    const text=JSON.stringify(envelope), ref=digest(text), target=blobPath(ref);
    await fs.mkdir(blobs,{recursive:true});
    try {
      // Stage and fsync before publishing a blob reference. Never leave a partial
      // final blob when the process dies halfway through a large evidence write.
      if(await stat(target)==='missing')await replace(target,text);
      else if(digest(await fs.readFile(target))!==ref)throw corrupt('已有证据校验失败');
    } catch(e) { throw e; }
    return ref;
  }
  async function evidence(ref) {
    let text;
    try { text=await fs.readFile(blobPath(ref),'utf8'); } catch(e) { if(e.code==='ENOENT')throw corrupt('缺少原始证据文件'); throw e; }
    if(digest(text)!==ref)throw corrupt('原始证据校验失败');
    try { return JSON.parse(text); } catch { throw corrupt('证据不是有效 JSON'); }
  }
  function keyEntries(entries) {
    const occurrences=new Map();
    return entries.map(entry=>{
      const m=entry.metadata;
      const identity=[m.kind,m.workspaceId,m.deliveryId??m.taskId??m.requestId??m.extensionId??m.id??JSON.stringify(m)];
      const base=digest(JSON.stringify(identity)), ordinal=occurrences.get(base)||0;
      occurrences.set(base,ordinal+1);
      return {...entry,key:`${base}-${ordinal}`};
    });
  }
  function validate(entries) {
    if(!Array.isArray(entries))throw corrupt('索引记录不是数组');
    const seen=new Set();
    for(const entry of entries) {
      if(!entry || !/^[a-f0-9]{64}-\d+$/.test(entry.key)||seen.has(entry.key)||!entry.metadata||typeof entry.metadata!=='object'||Array.isArray(entry.metadata))throw corrupt('索引记录无效或重复');
      if(entry.ref!==undefined)blobPath(entry.ref);
      seen.add(entry.key);
    }
    return entries;
  }
  async function load() {
    for(let attempt=0;attempt<3;attempt++) {
      const before=await inboxDiskRevision(file);
      let raw;
      try { raw=await fs.readFile(file,'utf8'); } catch(e) { if(e.code!=='ENOENT')throw e; }
      let parsed;
      try { parsed=raw===undefined?[]:JSON.parse(raw); } catch { throw corrupt('索引不是有效 JSON'); }
      let next;
      legacyText=undefined;validLogBytes=0;operations=0;
      if(Array.isArray(parsed)) {
        // Preserve the original array byte-for-byte before the first conversion.
        legacyText=raw;
        const entries=[];
        for(const record of parsed) {
          if(!record||typeof record!=='object'||Array.isArray(record))throw corrupt('旧记录无效');
          const {envelope,...metadata}=record;
          entries.push({metadata,...(envelope===undefined?{}:{ref:await saveEvidence(envelope),preview:inboxEvidencePreview(envelope)})});
        }
        next={format:FORMAT,version:2,generation:crypto.randomUUID(),sequence:0,entries:keyEntries(entries)};
      } else {
        if(parsed?.format!==FORMAT||parsed.version!==2||typeof parsed.generation!=='string'||!Number.isSafeInteger(parsed.sequence)||parsed.sequence<0)throw corrupt('索引格式不受支持');
        const {checksum,...index}=parsed;
        if(digest(JSON.stringify(index))!==checksum)throw corrupt('索引校验失败');
        next={...index,entries:validate(parsed.entries)};
        let bytes;
        try { bytes=await fs.readFile(log); } catch(e) { if(e.code!=='ENOENT')throw e; bytes=Buffer.alloc(0); }
        const end=bytes.lastIndexOf(10)+1;
        // A torn final append has no newline and was never acknowledged. Retain
        // its bytes until the next successful write truncates just that tail.
        validLogBytes=end;
        const records=new Map(next.entries.map(e=>[e.key,e]));
        let order=next.entries.map(e=>e.key);
        for(const line of bytes.subarray(0,end).toString('utf8').split('\n').filter(Boolean)) {
          let frame;
          try { frame=JSON.parse(line); } catch { throw corrupt('增量日志 JSON 无效'); }
          if(typeof frame.data!=='string'||digest(frame.data)!==frame.checksum)throw corrupt('增量日志校验失败');
          const change=JSON.parse(frame.data);
          if(change.generation!==next.generation)throw corrupt('日志与索引属于不同代次');
          if(!Number.isSafeInteger(change.sequence))throw corrupt('增量序号无效');
          if(change.sequence<=next.sequence)continue; // checkpoint published before journal rotation
          if(change.sequence!==next.sequence+1||!Array.isArray(change.remove))throw corrupt('增量序号不连续');
          for(const key of change.remove)records.delete(key);
          for(const entry of validate(change.put))records.set(entry.key,entry);
          if(change.order!==undefined) {
            if(!Array.isArray(change.order)||new Set(change.order).size!==change.order.length)throw corrupt('增量顺序无效');
            order=change.order;
          }
          if(order.length!==records.size||order.some(key=>!records.has(key)))throw corrupt('增量引用不完整');
          next.sequence=change.sequence;operations++;
        }
        next.entries=validate(order.map(key=>records.get(key)));
      }
      const after=await inboxDiskRevision(file);
      if(before===after) { state=next;revision=after;return structuredClone(state.entries); }
    }
    throw Object.assign(new Error('ERP 收件文件正在被其他进程修改，请稍后重试。'),{code:'ERP_INBOX_SPOOL_CHANGED'});
  }
  async function initialize() {
    if(legacyText!==undefined) {
      const backup=`${file}.legacy-${digest(legacyText)}.json`;
      if(await stat(backup)==='missing')await replace(backup,legacyText);
      else if(digest(await fs.readFile(backup))!==digest(legacyText))throw corrupt('旧格式保全副本不一致');
    }
    // Publish the new index last: a crash during conversion still sees the
    // untouched legacy array, never a new index replaying an old journal.
    await replace(log,'');
    await checkpoint();validLogBytes=0;operations=0;legacyText=undefined;
    revision=await inboxDiskRevision(file);
  }
  async function checkpoint() {await replace(file,JSON.stringify({...state,checksum:digest(JSON.stringify(state))}));}
  async function write(entries, expectedRevision) {
    if(!state)await load();
    if(expectedRevision!==undefined&&expectedRevision!==await inboxDiskRevision(file))throw Object.assign(new Error('ERP 收件文件已被外部修改，请重新读取后重试。'),{code:'ERP_INBOX_SPOOL_CHANGED'});
    const next=keyEntries(entries),old=new Map(state.entries.map(e=>[e.key,e]));
    const put=next.filter(e=>JSON.stringify(e)!==JSON.stringify(old.get(e.key)));
    const nextKeys=new Set(next.map(e=>e.key));
    const remove=state.entries.filter(e=>!nextKeys.has(e.key)).map(e=>e.key);
    const order=next.map(e=>e.key),orderChanged=JSON.stringify(order)!==JSON.stringify(state.entries.map(e=>e.key));
    if(!put.length&&!remove.length&&!orderChanged)return {revision:await inboxDiskRevision(file),writtenBytes:0};
    // A fresh or legacy queue is converted only when a write actually changes it.
    if(legacyText!==undefined||await stat(file)==='missing')await initialize();
    const change={generation:state.generation,sequence:state.sequence+1,put,remove,...(orderChanged?{order}:{})};
    const data=JSON.stringify(change),line=JSON.stringify({data,checksum:digest(data)})+'\n';
    if(await stat(log)==='missing')await replace(log,'');
    const handle=await fs.open(log,'r+');
    try {
      await handle.truncate(validLogBytes);
      const bytes=Buffer.from(line);
      for(let offset=0;offset<bytes.length;) {
        const written=await handle.write(bytes,offset,bytes.length-offset,validLogBytes+offset);
        if(!written.bytesWritten)throw new Error('ERP 增量日志未完整写入。');
        offset+=written.bytesWritten;
      }
      await handle.sync();
    }
    catch(e) {
      // A reported write/fsync failure must not publish a partial operation.
      // Leave the preceding complete frames intact for the next process.
      try {await handle.truncate(validLogBytes);await handle.sync();}catch{}
      await load();throw e;
    } finally { await handle.close(); }
    state={format:FORMAT,version:2,generation:state.generation,sequence:change.sequence,entries:next};
    validLogBytes+=Buffer.byteLength(line);operations++;
    // Compaction is maintenance after a durable commit. A failed compaction
    // cannot turn an acknowledged append into an apparent failed delivery.
    if(validLogBytes>=checkpointBytes||operations>=checkpointOperations) {
      try { await checkpoint();await replace(log,'');validLogBytes=0;operations=0; } catch { /* journal remains authoritative */ }
    }
    revision=await inboxDiskRevision(file);
    return {revision,writtenBytes:Buffer.byteLength(line)};
  }
  return {load,write,evidence,saveEvidence,get revision(){return revision;}};
}
