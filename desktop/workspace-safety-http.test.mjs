import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createInboxServiceController,requestJson}=require('./inbox-service.cjs');
const {createWorkspaceSafety}=require('./workspace-safety.cjs');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-safety-http-'));
const spoolPath=path.join(directory,'inbox.json'),port=32000+Math.floor(Math.random()*10000),capability='synthetic-safety-http-capability-0123456789';
const envelope={batch:{formatVersion:2,evidenceStatus:'complete',warehouseEvidence:[{evidenceComplete:true}],rows:[{platformSku:'SYNTHETIC',unitCost:0.004,raw:'evidence-'.repeat(250000)}]}};
const initial=[{kind:'request',requestId:'synthetic-request',workspaceId:'fixture',status:'registered',registeredAt:new Date().toISOString()},
  {kind:'batch',deliveryId:'synthetic-delivery',batchId:'synthetic-batch',workspaceId:'fixture',status:'acknowledged',envelope}];
await fs.writeFile(spoolPath,JSON.stringify(initial));
const controller=createInboxServiceController({executable:process.execPath,scriptPath:fileURLToPath(new URL('../tools/erp-inbox-server.mjs',import.meta.url)),spoolPath,port,capability,pollIntervalMs:100});
const input={fileName:'fixture.json',json:JSON.stringify({format:'shopeers-local-backup',formatVersion:1,tables:{products:[{id:'synthetic'}]},localCostDrafts:{formatVersion:1,entries:[]}})};
const options={directory:path.join(directory,'backups'),getInboxService:()=>controller};
try {
  await controller.start();
  for(let i=0;i<100&&controller.getState().status!=='online';i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(controller.getState().status,'online');
  const denied=await requestJson({port,capability,path:'/erp/v1/workspace-maintenance',method:'POST',body:{action:'begin'}});
  assert.equal(denied.statusCode,403,'the renderer/extension capability cannot export or replace local histories');
  const safety=createWorkspaceSafety(options);
  const exported=await controller.maintenanceRequest({action:'begin'});
  const backup={desktopInbox:exported.snapshot};
  assert.deepEqual(backup.desktopInbox.records,initial);
  await controller.maintenanceRequest({action:'end',maintenanceId:exported.maintenanceId});
  const held=await controller.maintenanceRequest({action:'begin-clear'});
  assert.equal(held.snapshot,undefined,'clear locks never export historical evidence');
  const blocked=await requestJson({port,capability,path:'/erp/v1/requests',method:'POST',body:{request:{id:'must-wait'}}});
  assert.equal(blocked.statusCode,503,'desktop snapshot remains frozen until deletion/abort');
  await controller.maintenanceRequest({action:'end',maintenanceId:held.maintenanceId});
  for(const blob of await fs.readdir(spoolPath+'.evidence'))await fs.writeFile(path.join(spoolPath+'.evidence',blob),'corrupt fixture');
  await safety.clear({confirmation:'清空本机数据'});
  await assert.rejects(fs.access(options.directory),{code:'ENOENT'});
  await assert.rejects(fs.access(spoolPath+'.evidence'),{code:'ENOENT'});
  assert.equal((await fs.readdir(directory)).some(name=>name.includes('.legacy-')),false);
  let session=await controller.maintenanceRequest({action:'begin'});
  assert.equal(session.snapshot.recordCount,0);await controller.maintenanceRequest({action:'end',maintenanceId:session.maintenanceId});
  const prepared=await safety.prepareRestore({snapshot:backup.desktopInbox,currentWorkspace:input});
  // A real child-process restart loses its in-memory lock. The native durable
  // journal and committed renderer marker must still complete the same import.
  await controller.retry();
  for(let i=0;i<100&&controller.getState().status!=='online';i++)await new Promise(r=>setTimeout(r,25));
  const resumed=createWorkspaceSafety(options);
  await resumed.recoverRestore({committedId:prepared.id});
  await resumed.finishRestore({id:prepared.id});
  session=await controller.maintenanceRequest({action:'begin'});
  assert.deepEqual(session.snapshot.records,initial);
  await controller.maintenanceRequest({action:'end',maintenanceId:session.maintenanceId});
  const status=await requestJson({port,capability});
  assert.equal(status.payload.latestBatch.rowCount,1);
  assert.equal(status.payload.latestBatch.evidenceStatus,'complete','cold summary preserves desktop evidence status');
  console.log('Native controller HTTP: no-snapshot clear without backup or evidence hydration, physical archive purge, protected freeze, child restart and complete restore passed');
}finally{await controller.stop({wait:true});await fs.rm(directory,{recursive:true,force:true});}
