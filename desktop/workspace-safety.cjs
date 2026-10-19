const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createBackupSaver,validateBackupRequest}=require('./workspace-backup.cjs');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');

function createWorkspaceSafety({directory,getInboxService,operations=fs,isTrusted=()=>true}) {
  let busy=false;
  const clearTokens=new Map();
  const journalPath=path.join(directory,'pending-inbox-restore.json');
  const service=()=>{const value=getInboxService();if(!value)throw new Error('本机收件服务尚未就绪。');return value;};
  const maintain=body=>service().maintenanceRequest(body);
  const saver=createBackupSaver({operations,isTrusted,showSaveDialog:async options=>({canceled:false,filePath:path.join(directory,options.defaultPath)})});
  async function fileDigest(file) {
    const handle=await operations.open(file,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(64*1024);
    try {for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}}finally{await handle.close();}
    return hash.digest('hex');
  }
  async function saveCombined(input,snapshot,prefix) {
    const workspace=JSON.parse(validateBackupRequest(input).json);
    workspace.desktopInbox=snapshot;
    workspace.manifest={...workspace.manifest,desktopInboxIncluded:true,desktopRecordCount:snapshot.recordCount,desktopLeaseCount:snapshot.leaseCount};
    const json=JSON.stringify(workspace),fileName=`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.json`;
    await operations.mkdir(directory,{recursive:true});
    const receipt=await saver({fileName,json});
    if(receipt.status!=='saved')throw new Error(receipt.error||'清空前备份未保存，未执行清空。');
    const filePath=path.join(directory,fileName),sha256=await fileDigest(filePath);
    if(sha256!==digest(json))throw new Error('备份回读校验失败，未执行清空。');
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
  async function saveBeforeClear(input) {
    return locked(async()=>{
      validateBackupRequest(input);
      if(await readJournal())throw new Error('上次恢复尚未完成，请先重试恢复检查。');
      const session=await maintain({action:'begin'});
      try {
        const receipt=await saveCombined(input,session.snapshot,'Lworkstation-before-clear');
        if(!isTrusted())throw new Error('工作站已离开当前页面，未执行清空。');
        const backupToken=crypto.randomUUID();
        clearTokens.set(backupToken,{...receipt,maintenanceId:session.maintenanceId});
        return {...receipt,backupToken};
      } catch(e) {await end(session.maintenanceId);throw e;}
    });
  }
  async function clear({backupToken}={}) {
    return locked(async()=>{
      const receipt=clearTokens.get(backupToken);
      if(!receipt)throw new Error('必须先成功保存并校验清空前备份。');
      try {
        if(await fileDigest(receipt.filePath)!==receipt.sha256)throw new Error('清空前备份已变化，未执行清空。');
        const result=await service().clearBusinessData({maintenanceId:receipt.maintenanceId});
        return {...result,backupFilePath:receipt.filePath};
      }finally{clearTokens.delete(backupToken);await end(receipt.maintenanceId);}
    });
  }
  async function cancelClear({backupToken}={}) {
    const receipt=clearTokens.get(backupToken);clearTokens.delete(backupToken);
    if(receipt)await end(receipt.maintenanceId);
    return {ok:true};
  }
  async function prepareRestore({snapshot,currentWorkspace}={}) {
    return locked(async()=>{
      validateBackupRequest(currentWorkspace);
      if(await readJournal())throw new Error('上次恢复尚未完成，请先重试恢复检查。');
      await maintain({action:'validate',snapshot});
      const session=await maintain({action:'begin'});
      try {
        const backup=await saveCombined(currentWorkspace,session.snapshot,'Lworkstation-before-restore');
        const journal={version:1,id:crypto.randomUUID(),maintenanceId:session.maintenanceId,phase:'prepared',target:snapshot,backup};
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
        catch {const session=await maintain({action:'begin'});journal.maintenanceId=session.maintenanceId;await writeJournal(journal);}
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
  return {saveBeforeClear,clear,cancelClear,prepareRestore,recoverRestore,finishRestore};
}
module.exports={createWorkspaceSafety};
