// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ErpAssistantSetup from './ErpAssistantSetup';
const mocks = vi.hoisted(() => ({ notify: vi.fn(), history: vi.fn(), extension: vi.fn() }));
vi.mock('../lib/erpInboxTransport', () => ({ getErpRequestHistory: mocks.history, getErpExtensionStatus: mocks.extension }));
vi.mock('../data/database', () => ({ getActiveMemberContext: async () => ({ workspaceId: 'W' }) }));
vi.mock('./UI', async original => ({ ...await original(), useToast: () => ({ notify: mocks.notify }) }));
let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; mocks.notify.mockClear(); mocks.extension.mockResolvedValue({ records: [{ extensionId:'erp-assistant',online:true,ready:true,version:'8.0.33' }] });host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async () => { if(root) await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
it.each(['resolve','reject'])('ignores a late %s after the ERP setup is closed',async outcome=>{
  let resolve,reject;mocks.history.mockReturnValue(new Promise((yes,no)=>{resolve=yes;reject=no;}));
  await act(async()=>root.render(<MemoryRouter><ErpAssistantSetup/></MemoryRouter>));
  await act(async()=>root.unmount());root=null;
  await act(async()=>{if(outcome==='resolve')resolve({records:[]});else reject(new Error('service offline'));});
  expect(mocks.notify).not.toHaveBeenCalled();
});
