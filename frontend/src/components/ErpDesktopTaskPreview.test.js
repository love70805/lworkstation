// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

it('shows the real desktop task on ERP home without legacy acquisition controls or writes', async () => {
  const collectionTask=vi.fn().mockResolvedValue({ok:true,tasks:[{executionTarget:'desktop',ledgerPeriod:'2026-10',status:'running',summary:{total:231,collected:30,delivered:25,adopted:107},batches:[{platformSkcs:['QA-SKC'],status:'running'}]}]});
  window.ShopeersErpDeliveryBridge={collectionTask};
  window.chrome={storage:{local:{get:(_keys,callback)=>callback({shopeersErpDesktopTaskUi:true})}}};
  window.eval(readFileSync('../integrations/erp-assistant-extension/src/desktop-task-preview.js','utf8'));
  try {
    expect(await window.ShopeersErpTaskPreview.isManaged()).toBe(true);
    window.ShopeersErpTaskPreview.mount();
    await vi.waitFor(()=>expect(document.querySelector('.erpa-task-body').textContent).toContain('25 / 231'));
    expect(document.querySelector('.erpa-task-body').textContent).toContain('107 个 SKU');
    expect(document.querySelector('#erpa-recalculate,#erpa-copy,#erpa-error')).toBeNull();
    document.getElementById('erpa-cost-trigger').click();
    expect(document.getElementById('erpa-cost-root').classList.contains('erpa-open')).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(collectionTask.mock.calls.every(([input])=>input.action==='list')).toBe(true);
    collectionTask.mockResolvedValue({ok:true,tasks:[{executionTarget:'desktop',status:'paused',pauseReason:{code:'ERP_PERMISSION_REQUIRED'},batches:[]}]});
    await window.ShopeersErpTaskPreview.refresh();
    expect(document.querySelector('.erpa-task-body').textContent).toContain('店铺权限校验未通过，采集已暂停');
    expect(document.querySelector('.erpa-task-body').textContent).toContain('确认 ERP 采购管理可正常查询');
    expect(document.querySelector('.erpa-task-body').textContent).not.toContain('登录');
    expect(collectionTask.mock.calls.every(([input])=>input.action==='list')).toBe(true);
    collectionTask.mockResolvedValue({ok:false});
    await window.ShopeersErpTaskPreview.refresh();
    expect(document.querySelector('.erpa-task-body').textContent).toContain('暂时无法读取任务进度');
  } finally {
    document.getElementById('erpa-cost-trigger')?.remove();document.getElementById('erpa-cost-root')?.remove();
    delete window.ShopeersErpDeliveryBridge;delete window.ShopeersErpTaskPreview;delete window.chrome;
  }
});
