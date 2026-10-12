import { expect, it } from 'vitest';
import { buildLedgerSkuIdentityIndex, resolveLedgerCostDecision, describeLedgerCostIdentityIssue, ledgerCostIdentityIssue } from './ledgerCostIdentity';
import { buildReportProducts } from './profitReports';
import { calculateLedgerCostCoverage } from './costCoverage';

const scope = { workspaceId:'W', ledgerId:'L', store:'甲', platformSku:'SKU', period:'2026-08' };
const records = [{recordId:'R',warehouseSku:'WH',purchaseDate:'2026-08-01',quantity:10,unitPrice:5}];
const cost = {id:'C',platformSku:'SKU',platformSkc:'SKC-A',warehouseSku:'WH',unitCost:5,currency:'CNY',resolutionStatus:'resolved',evidenceComplete:true,purchaseRecords:records,selectedRecordIds:['R']};
const manual = amount => ({id:'M',...scope,status:'approved',currency:'CNY',approvedAmount:amount,approvedBy:'finance',approvedAt:'2026-09-01T00:00:00Z',reason:'真实人工成本',referenceCost:{kind:'manual_override',store:'甲'}});
const source = (skc,store='甲') => ({...scope,store,platformSkc:skc,quantity:1,amount:100});

it('normalizes identity across stores without rewriting source rows',()=>{
  const rows=[source('ＳＫＣ－Ａ'),{...source('skc-a','乙'),platformSku:' sku '}];
  const before=structuredClone(rows),identity=buildLedgerSkuIdentityIndex(rows).get('SKU');
  expect(identity.platformSkcs.size).toBe(1);
  expect(resolveLedgerCostDecision({...scope,identity,erpCost:cost})).toMatchObject({eligibleForExactProfit:true,source:'erp',unitCost:5});
  expect(rows).toEqual(before);
});

it.each([0,0.0000001])('preserves manual %s for a unique parent but cannot use it to resolve multiple parents',amount=>{
  const approval=manual(amount),unique=buildLedgerSkuIdentityIndex([source('SKC-B')]).get('SKU');
  expect(resolveLedgerCostDecision({...scope,identity:unique,erpCost:cost,manualOverride:approval})).toMatchObject({source:'manual_override',unitCost:amount,eligibleForExactProfit:true});
  const conflict=buildLedgerSkuIdentityIndex([source('SKC-A'),source('SKC-B','乙')]).get('SKU');
  const blocked=resolveLedgerCostDecision({...scope,identity:conflict,erpCost:cost,manualOverride:approval});
  expect(blocked).toMatchObject({unitCost:null,eligibleForExactProfit:false,identityIssue:{code:'ledger_sku_skc_conflict'}});
  expect(describeLedgerCostIdentityIssue(blocked.identityIssue)).toContain('SKC-A、SKC-B');
  expect(approval.approvedAmount).toBe(amount);
});

it('rejects known mismatching ERP parents while retaining a missing-cost projection',()=>{
  const ledger={id:'L',workspaceId:'W',period:scope.period,warehouseRate:0.7};
  const rows=[source('SKC-B')];
  const input={ledger,salesRows:rows,erpCosts:[cost],approvals:[]};
  expect(()=>buildReportProducts(input)).toThrow('SKC-B 与已采用 ERP 成本 SKC SKC-A 不一致');
  expect(buildReportProducts({...input,allowMissing:true})[0]).toMatchObject({unitCostExact:null,costIdentityIssue:{code:'erp_cost_skc_mismatch'}});
});

it('preserves eligible historical costs without persisted SKC while requiring it on new adoption',()=>{
  const identity=buildLedgerSkuIdentityIndex([source('SKC-A')]).get('SKU'),old={...cost,platformSkc:''};
  expect(resolveLedgerCostDecision({...scope,identity,erpCost:old})).toMatchObject({eligibleForExactProfit:true,source:'erp',unitCost:5});
  expect(calculateLedgerCostCoverage({...scope,salesRows:[source('SKC-A')],erpCosts:[old]})).toMatchObject({missingCount:0,identityIssues:[]});
  expect(ledgerCostIdentityIssue(identity,old,{requireSkc:true}).code).toBe('erp_cost_skc_unverified');
});

it('counts all stores of a conflicting SKU as unresolved even when one has a manual amount',()=>{
  const coverage=calculateLedgerCostCoverage({...scope,salesRows:[source('SKC-A'),source('SKC-B','乙')],erpCosts:[cost],approvals:[manual(0)]});
  expect(coverage).toMatchObject({expectedCount:2,erpMatchedCount:0,manualOverrideCount:0,formalMatchedCount:0,missingCount:2,identityIssues:[{code:'ledger_sku_skc_conflict'}]});
});
