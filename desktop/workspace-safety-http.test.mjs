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
  const safety=createWorkspaceSafety(options),saved=await safety.saveBeforeClear(input);
  const backup=JSON.parse(await fs.readFile(saved.filePath,'utf8'));
  assert.equal(backup.formatVersion,2,'old applications must not silently import only the IndexedDB part');
  assert.deepEqual(backup.desktopInbox.records,initial,'backup contains exact archived purchase evidence and request metadata');
  assert.ok(!JSON.stringify(backup).includes(capability));
  const blocked=await requestJson({port,capability,path:'/erp/v1/requests',method:'POST',body:{request:{id:'must-wait'}}});
  assert.equal(blocked.statusCode,503,'desktop snapshot remains frozen until deletion/abort');
  await safety.clear(saved);
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
  console.log('Native controller HTTP: full archived evidence backup, protected freeze/reset, child restart and complete restore passed');
}finally{await controller.stop({wait:true});await fs.rm(directory,{recursive:true,force:true});}
