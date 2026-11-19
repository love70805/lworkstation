// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import PurchaseEvidenceDetails from './PurchaseEvidenceDetails';
import { calculateWarehouseCostDecision } from '../domain/erpCostResolution';

it('opens with historical limits, flags only matching purchases, and expands both kinds of excluded orders', async () => {
  const warehouseSku = 'DEMO-WAREHOUSE';
  const records = [5,5,5,5,5,2,2.1,5,6].map((unitPrice, i) => ({
    warehouseSku, recordId: 'r' + i, purchaseOrderNo: 'DEMO-PO-' + i,
    unitPrice, quantity: 2, purchaseDate: i === 8 ? '2026-11-01' : '2026-10-0' + (i + 1),
  }));
  const costDecision = calculateWarehouseCostDecision({warehouseSku, period:'2026-10', purchaseRecords:records, evidenceComplete:true});
  const excluded = { ...records[0], recordId:'voided', purchaseOrderNo:'DEMO-CANCELLED', statusFields:{purchaseOrderStatus1688:4}, exclusionReasons:['cancelled_or_closed'] };
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<PurchaseEvidenceDetails match={{warehouseSku,costDecision,excludedRecords:[excluded]}} period="2026-10"/>));
    expect(node.textContent).toContain('8 笔合格正单价');
    expect(node.textContent).toContain('¥3.5000 ～ ¥6.5000/件');
    const lines = [...node.querySelector('.purchase-review-list').children].map(line => line.textContent);
    expect(lines[0]).toMatch(/¥5\.0000\/件未触发异常.*DEMO-PO-7/);
    expect(lines[1]).toMatch(/¥2\.1000\/件价格异常待核对.*低于历史下限 ¥3\.5000/);
    expect(lines[2]).toMatch(/¥2\.0000\/件价格异常待核对.*低于历史下限 ¥3\.5000/);
    const [erp, month] = [...node.querySelectorAll('details')];
    expect(erp.textContent).not.toContain('DEMO-CANCELLED');
    for (const item of [erp, month]) await act(async () => { item.open = true; item.dispatchEvent(new Event('toggle')); });
    expect(erp.textContent).toMatch(/DEMO-CANCELLED.*取消.*已取消（4）/);
    expect(month.textContent).toMatch(/DEMO-PO-8.*晚于本次核算月/);
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
