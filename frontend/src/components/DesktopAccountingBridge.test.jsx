// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import DesktopAccountingBridge from './DesktopAccountingBridge';
import { readAccountingMode } from '../data/repositories/inventoryAccountingRepository';
import { db } from '../data/db/clientDatabase';
vi.mock('../data/repositories/selectionRepository', () => ({ getActiveMemberContext: async () => ({ workspaceId: 'TITLE-QA' }) }));

it('receives the desktop title event outside routed pages and unregisters it when unmounted', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await db.settings.delete('inventory-accounting:TITLE-QA');
  let callback;
  const remove=vi.fn();
  window.shopeersDesktopRuntime={onAccountingToggle:fn=>{callback=fn;return remove;}};
  const host=document.createElement('div'),root=createRoot(host);
  try {
    await act(async()=>root.render(<DesktopAccountingBridge/>));
    await act(async()=>callback());
    await vi.waitFor(async()=>expect(await readAccountingMode('TITLE-QA')).toBe('historical_lowest'));
    await act(async()=>callback());
    await vi.waitFor(async()=>expect(await readAccountingMode('TITLE-QA')).toBe('weighted'));
  } finally {
    await act(async()=>root.unmount());
    expect(remove).toHaveBeenCalledOnce();
    delete window.shopeersDesktopRuntime;
    await db.settings.delete('inventory-accounting:TITLE-QA');
  }
});
