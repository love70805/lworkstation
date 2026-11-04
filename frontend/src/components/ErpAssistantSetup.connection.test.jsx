// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ErpAssistantSetup,{ERP_ASSISTANT_VERSION,selectCurrentErpExtension,erpAssistantSetupState} from './ErpAssistantSetup';
import {ToastProvider} from './UI';

const mock=vi.hoisted(()=>({history:vi.fn(),status:vi.fn()}));
vi.mock('../lib/erpInboxTransport',()=>({getErpRequestHistory:mock.history,getErpExtensionStatus:mock.status}));
vi.mock('../data/database',()=>({getActiveMemberContext:async()=>({workspaceId:'synthetic-workspace'})}));
const page=(version=ERP_ASSISTANT_VERSION,extra={})=>({extensionId:'erp-assistant',version,online:true,ready:true,lastSeenAt:new Date().toISOString(),...extra});
const installation=(extra={})=>({...page(),extensionId:'erp-assistant-installation',ready:false,...extra});
let root,container;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;mock.history.mockReset().mockResolvedValue({records:[]});mock.status.mockReset();});
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();root=null;container=null;delete window.shopeersDesktopRuntime;});
async function mount(records,desktop=true){
 if(desktop)window.shopeersDesktopRuntime={desktop:true,version:'1.2.2'};
 mock.status.mockResolvedValue({records});container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter><ToastProvider><ErpAssistantSetup diagnostics/></ToastProvider></MemoryRouter>));
 return container.textContent;
}
it('prefers an online main-page handshake over historical installation receipts',()=>{
 const live=page(),old=installation({version:'8.0.55',online:false});
 expect(selectCurrentErpExtension([old,live])).toBe(live);
});
it('uses an online installation signal only when the current main page is absent',()=>{
 const old=page('8.0.55',{online:false}),live=installation();
 expect(selectCurrentErpExtension([old,live])).toBe(live);
 expect(erpAssistantSetupState('online',live)).toBe('waiting-refresh');
});
it('never treats an offline old version as a current update requirement or a connected signal',()=>{
 const old=page('8.0.55',{online:false});
 expect(selectCurrentErpExtension([old])).toBeNull();
 expect(erpAssistantSetupState('online',old)).toBe('not-detected');
});
it('requires the local service even when a ready receipt is provided',()=>expect(erpAssistantSetupState('offline',page())).toBe('service-offline'));
it('still detects a genuinely online old version',()=>expect(erpAssistantSetupState('online',page('8.0.55'))).toBe('outdated'));
it('does not promote iframe-only or malformed online records to a current main page',()=>{
 expect(selectCurrentErpExtension([page('8.0.57',{extensionId:'erp-assistant-frame-1'}),page('8.0.55',{online:'true'})])).toBeNull();
 expect(selectCurrentErpExtension(null)).toBeNull();
});
it('shows the bundled version and a pending connection for yesterday’s offline receipts in the desktop card',async()=>{
 const text=await mount([page('8.0.55',{online:false,lastSeenAt:'2026-11-03T06:25:58.729Z'}),installation({version:'8.0.55',online:false,lastSeenAt:'2026-11-03T05:59:40.768Z'})]);
 expect(text).toContain(`程序内置 v${ERP_ASSISTANT_VERSION}`);expect(text).toContain('等待内置 ERP 页面连接');expect(text).toContain('待连接');
 expect(text).not.toContain('需更新');expect(text).not.toContain('待随应用更新');expect(text).not.toContain('当前 v8.0.55');
});
it('shows a connected desktop only after an online current page handshake',async()=>{
 const text=await mount([page()]);expect(text).toContain('内置扩展已运行');expect(text).toContain('已连接');expect(text).toContain(`v${ERP_ASSISTANT_VERSION}`);
});
it('describes a live older desktop receipt as a refresh requirement rather than an application upgrade failure',async()=>{
 const text=await mount([page('8.0.55')]);expect(text).toContain('收到旧版扩展回执');expect(text).toContain('回执 v8.0.55');expect(text).toContain(`程序内置 v${ERP_ASSISTANT_VERSION}`);expect(text).toContain('待刷新');expect(text).not.toContain('待随应用更新');
});
it('keeps the browser extension download for an online old browser version',async()=>{
 const text=await mount([page('8.0.55')],false);expect(text).toContain('扩展版本需要更新');expect(text).toContain(`下载 v${ERP_ASSISTANT_VERSION} 更新包`);expect(container.querySelector('.erp-extension-update-link')?.getAttribute('href')).toContain(ERP_ASSISTANT_VERSION);
});
