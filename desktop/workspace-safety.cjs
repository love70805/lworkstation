const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createBackupSaver,validateBackupRequest}=require('./workspace-backup.cjs');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');

function createWorkspaceSafety({directory,getInboxService,operations=fs,isTrusted=()=>true,saveBackup:saveManualBackup}) {
  let busy=false;
  const journalPath=path.join(directory,'pending-inbox-restore.json');
  const service=()=>{const value=getInboxService();if(!value)throw new Error('本机收件服务尚未就绪。');return value;};
  const maintain=body=>service().maintenanceRequest(body);
  const saver=createBackupSaver({operations,isTrusted,showSaveDialog:async options=>({canceled:false,filePath:path.join(directory,options.defaultPath)})});
  async function fileDigest(file) {
    const handle=await operations.open(file,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(64*1024);
    try {for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}}finally{await handle.close();}
    return hash.digest('hex');
  }
  function combinedBackup(input,snapshot) {
    const workspace=JSON.parse(validateBackupRequest(input).json);
    workspace.formatVersion=2;
    workspace.desktopInbox=snapshot;
    workspace.manifest={...workspace.manifest,desktopInboxIncluded:true,desktopRecordCount:snapshot.recordCount,desktopLeaseCount:snapshot.leaseCount};
    return {fileName:input.fileName,json:JSON.stringify(workspace)};
  }
  async function saveCombined(input,snapshot,prefix) {
    const {json}=combinedBackup(input,snapshot),fileName=`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.json`;
    await operations.mkdir(directory,{recursive:true});
    const receipt=await saver({fileName,json});
    if(receipt.status!=='saved')throw new Error(receipt.error||'恢复前备份未保存，未执行恢复。');
    const filePath=path.join(directory,fileName),sha256=await fileDigest(filePath);
    if(sha256!==digest(json))throw new Error('备份回读校验失败，未执行恢复。');
    return {...receipt,filePath,sha256};
  }
  async function writeJournal(value) {
    const staging=`${journalPath}.${crypto.randomUUID()}.tmp`;
    try {
      const handle=await operations.open(staging,'wx',0o600);
      try {await handle.writeFile(JSON.stringify(value),'utf8');await handle.sync();}finally{await handle.close();}
      await operations.rename(staging,journalPath);
    }finally{await operations.unlink(staging).catch(()=>{});}
  }
  async function readJournal() {
    try {const value=JSON.parse(await operations.readFile(journalPath,'utf8'));if(value?.version!==1||typeof value.id!=='string'||!value.target)throw Error('恢复保护记录无效，请保留备份。');return value;}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async function locked(run) {
    if(busy)throw new Error('已有本机备份或恢复正在进行。');
    if(!isTrusted())throw new Error('无效的工作站请求。');
    busy=true;try{return await run();}finally{busy=false;}
  }
  async function end(maintenanceId) {if(maintenanceId)await maintain({action:'end',maintenanceId});}
  async function exportBackup(input) {
    return locked(async()=>{
      const workspace=JSON.parse(validateBackupRequest(input).json);
      if(workspace.format!=='shopeers-local-backup'||typeof saveManualBackup!=='function')throw new Error('完整本机导出接口尚未就绪。');
      if(await readJournal())throw new Error('上次恢复尚未完成，请先重试恢复检查。');
      const session=await maintain({action:'begin'});
      try {return await saveManualBackup(combinedBackup(input,session.snapshot));}
      finally{await end(session.maintenanceId);}
    });
  }
  async function clear({confirmation}={}) {
    return locked(async()=>{
      if(confirmation!=='清空本机数据')throw new Error('请输入“清空本机数据”确认永久清空。');
      if(await readJournal())throw new Error('上次恢复尚未完成，请先重试恢复检查。');
      const session=await maintain({action:'begin-clear'});
      let clearStarted=false;
      try {
        try {
          if(!isTrusted())throw new Error('工作站已离开当前页面，未执行清空。');
          clearStarted=true;
          return await service().clearBusinessData({maintenanceId:session.maintenanceId});
        }finally{await end(session.maintenanceId);}
      }catch(error){error.clearStarted=clearStarted;throw error;}
    });
  }
  async function prepareRestore({snapshot,currentWorkspace,targetWorkspace}={}) {
    return locked(async()=>{
      validateBackupRequest(currentWorkspace);
      if(targetWorkspace)validateBackupRequest(targetWorkspace);
      if(await readJournal())throw new Error('上次恢复尚未完成，请先重试恢复检查。');
      await maintain({action:'validate',snapshot});
      const session=await maintain({action:'begin'});
      try {
        const backup=await saveCombined(currentWorkspace,session.snapshot,'Lworkstation-before-restore');
        const journal={version:1,id:crypto.randomUUID(),maintenanceId:session.maintenanceId,phase:'prepared',target:snapshot,targetWorkspace:targetWorkspace??currentWorkspace,backup};
        await writeJournal(journal);
        return {ok:true,id:journal.id,backupFilePath:backup.filePath};
      }catch(e){await end(session.maintenanceId);throw e;}
    });
  }
  async function recoverRestore({committedId}={}) {
    return locked(async()=>{
      const journal=await readJournal();
      if(!journal) {if(committedId)throw new Error('缺少桌面恢复保护记录，请保留回滚备份并重试。');return {ok:true};}
      if(committedId&&committedId!==journal.id)throw new Error('桌面与工作区恢复记录不一致，请保留回滚备份。');
      if(committedId) {
        try {await maintain({action:'hold',maintenanceId:journal.maintenanceId});}
        catch {
          // Persist this obligation before acquiring a replacement lock. A
          // failed save must remain mandatory on every retry, even when hold()
          // succeeds against the replacement service process.
          journal.backupRequired=true;await writeJournal(journal);
          const session=await maintain({action:'begin'});journal.maintenanceId=session.maintenanceId;await writeJournal(journal);
        }
        if(journal.backupRequired) {
          const current=await maintain({action:'snapshot',maintenanceId:journal.maintenanceId});
          journal.recoveryBackup=await saveCombined(journal.targetWorkspace,current.snapshot,'Lworkstation-recovery-current');
          journal.backupRequired=false;await writeJournal(journal);
        }
        await maintain({action:'restore',maintenanceId:journal.maintenanceId,snapshot:journal.target});
        journal.phase='committed';await writeJournal(journal);
      }
      await end(journal.maintenanceId).catch(e=>{if(committedId)throw e;});
      return {ok:true,id:journal.id,phase:journal.phase};
    });
  }
  async function finishRestore({id}={}) {
    return locked(async()=>{
      const journal=await readJournal();
      if(journal&&journal.id!==id)throw new Error('桌面恢复记录不一致。');
      if(journal)await operations.unlink(journalPath);
      return {ok:true};
    });
  }
  return {clear,exportBackup,prepareRestore,recoverRestore,finishRestore};
}
module.exports={createWorkspaceSafety};
