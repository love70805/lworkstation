import { expect, it } from 'vitest';
import { normalizeErpDiagnostic } from './erpDiagnostics';
import { buildErpCostBatchEnvelope, validateErpCostBatchEnvelope } from './erpCostBatchEnvelope';

it('preserves bounded ERP business responses through transport without credentials or cost eligibility', () => {
  const raw = { stage: '平台映射', httpStatus: 200, code: 17, msg: '映射未返回', token: 'hidden-value', data: [{ platformSku: 'sku-hjl', password: 'hidden-value', nested: { session: 'hidden-value', purchaseOrderNo: '00012345678901234567890' } }] };
  const diagnostic = normalizeErpDiagnostic(raw);
  expect(diagnostic).toContain('00012345678901234567890');
  expect(diagnostic).not.toContain('hidden-value');
  const envelope = buildErpCostBatchEnvelope({ batchId: 'B', workspaceId: 'W', ledgerId: 'L', requestId: 'R', platformSkcs: ['SKC'], results: [{warehouseSku:'WH',mappings:[],unitCost:null}], warehouseEvidence: [{warehouseSku:'WH',evidenceComplete:false,purchaseRecords:[]}],
    sourceMeta: { mappingFailures: [{ warehouseSku: 'WH', message: '映射失败', erpResponse: JSON.stringify(raw) }] } });
  const parsed = validateErpCostBatchEnvelope(JSON.parse(JSON.stringify(envelope)));
  expect(parsed.envelope.sourceMeta.mappingFailures[0].erpResponse).toBe(diagnostic);
  expect(parsed.rows.every(row=>row.eligibleForExactProfit !== true)).toBe(true);
  expect(normalizeErpDiagnostic({ data: Array(999).fill({ large: 'x'.repeat(9999), secret: 'hidden-value' }) }).length).toBeLessThanOrEqual(2400);
  expect(normalizeErpDiagnostic('not json')).toBe('');
});
