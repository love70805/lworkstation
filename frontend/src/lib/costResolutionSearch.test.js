import { describe, expect, it } from 'vitest';
import { reconcileErpCostRows } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope, parseErpCostBatchJson } from '../domain/erpCostBatchEnvelope';
import { groupCostAnomalies, filterCostAnomalyGroups, filterCostMatches } from './costMatching';
it('reproduces hidden correction for a nonrepresentative shared-warehouse SKU',()=>{
 const expectedSkus=[{platformSku:'QA-FIRST',platformSkc:'QA-SKC-A'},{platformSku:'QA-SECOND-3',platformSkc:'QA-SKC-B'}];
 const envelope=buildErpCostBatchEnvelope({batchId:'QA-BATCH',workspaceId:'workspace-default',ledgerId:'QA-LEDGER',requestId:'QA-REQUEST',platformSkcs:['QA-SKC-A','QA-SKC-B'],expectedSkus,generatedAt:'2026-09-08T08:00:00.000Z',results:[{warehouseSku:'QA-WH',mappings:expectedSkus,previewUnitCost:0}],warehouseEvidence:[{warehouseSku:'QA-WH',evidenceComplete:true,purchaseRecords:[{recordId:'QA-ZERO',warehouseSku:'QA-WH',purchaseDate:'2026-07-01',quantity:2,unitPrice:0,eligible:true,exclusionReasons:[]}]}]});
 const parsed=parseErpCostBatchJson(JSON.stringify(envelope));
 const result=reconcileErpCostRows({workspaceId:'workspace-default',expectedSkus,costRows:parsed.rows});
 expect(result.summary.anomalyPendingCount).toBe(2);
 expect(filterCostMatches(result.matches,'QA-SECOND-3')).toHaveLength(1);
 const oldGroups=[...new Map(result.matches.map(m=>[m.sourceWarehouseSku,result.matches.find(first=>first.sourceWarehouseSku===m.sourceWarehouseSku)])).values()];
 expect(filterCostMatches(oldGroups,'QA-SECOND-3')).toHaveLength(0);
 const groups=groupCostAnomalies(result.matches,[{platformSku:'QA-SECOND-3',attribute:'合成蓝色'}]);
 expect(groups).toHaveLength(1);
 for (const query of ['QA-FIRST','QA-SECOND-3','QA-SKC-A','QA-SKC-B','QA-WH','合成蓝色','']) {
   expect(filterCostAnomalyGroups(groups,query)).toHaveLength(1);
   expect(filterCostAnomalyGroups(groups,query)[0].costDecision.anomalies).toHaveLength(1);
 }
 expect(filterCostAnomalyGroups(groups,'不存在')).toHaveLength(0);
 expect(groupCostAnomalies(result.matches.map(match=>({...match,status:'matched',resolvedAnomalyCount:0})))).toHaveLength(0);
});

