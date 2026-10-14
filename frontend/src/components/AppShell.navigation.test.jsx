// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AppShell from './AppShell';
import { ToastProvider } from './UI';
const mocks=vi.hoisted(()=>({member:vi.fn(),ledger:vi.fn(),create:vi.fn(),record:vi.fn(),save:vi.fn()}));
vi.mock('../data/database',()=>({db:{ledgers:{get:mocks.ledger}},getActiveMemberContext:mocks.member,getWorkspaceOperationalSummary:vi.fn(),createWorkspaceBackupPayload:mocks.create,recordWorkspaceBackupExport:mocks.record}));
vi.mock('../hooks/useSystemSnapshot',()=>({useSystemSnapshot:()=>({status:'error',data:null,error:'只读检查样例',refresh:async()=>({status:'error',error:'只读检查样例'})})}));
vi.mock('../hooks/useCloudAuth',()=>({useCloudAuth:()=>({user:null})}));
vi.mock('./CloudAuthDialog',()=>({default:()=>null}));
vi.mock('./ErpBackgroundNotice',()=>({default:()=>null}));
let host,root;
const button=text=>[...host.querySelectorAll('button')].find(node=>node.textContent===text||node.getAttribute('aria-label')===text);
async function waitFor(assertion){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});await vi.waitFor(assertion);}
beforeEach(async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();localStorage.clear();
 mocks.member.mockRejectedValue(new Error('月份读取失败样例'));
 mocks.ledger.mockResolvedValue({id:'L',workspaceId:'W'});
 mocks.create.mockResolvedValue({generatedAt:'2026-10-14T00:00:00Z',recordCount:2,tables:{}});
 window.shopeersDesktopRuntime={desktop:true,saveBackup:mocks.save};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/diagnostics?ledger=L&store=A']}><ToastProvider><AppShell><p>系统检查可继续使用</p></AppShell></ToastProvider></MemoryRouter>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.shopeersDesktopRuntime;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
it('keeps the page available when navigation reads fail and restores scoped links after retry',async()=>{
 await waitFor(()=>expect(host.querySelector('.system-check-error')?.textContent).toContain('月份读取失败样例'));
 expect(host.textContent).toContain('系统检查可继续使用');expect(host.querySelector('a[href="/profit"]')).not.toBeNull();
 mocks.member.mockResolvedValue({workspaceId:'W'});
 await act(async()=>button('重试月份导航').click());
 await waitFor(()=>expect(host.querySelector('a[href="/profit?ledger=L&store=A"]')).not.toBeNull());
 expect(host.querySelector('.system-check-error')).toBeNull();
});
it('also contains a failed ledger read and never carries unverified scope into links',async()=>{
 await waitFor(()=>expect(button('重试月份导航')).toBeTruthy());
 mocks.member.mockResolvedValue({workspaceId:'W'});mocks.ledger.mockRejectedValue(new Error('账本读取失败样例'));
 await act(async()=>button('重试月份导航').click());
 await waitFor(()=>expect(host.querySelector('.system-check-error')?.textContent).toContain('账本读取失败样例'));
 expect(host.querySelector('a[href="/profit"]')).not.toBeNull();
});
it('reports a saved settings backup separately from a failed record registration',async()=>{
 mocks.save.mockResolvedValue({status:'saved',fileName:'settings-backup.json',sizeBytes:20});mocks.record.mockRejectedValue(new Error('登记失败样例'));
 await act(async()=>button('打开账户菜单').click());await act(async()=>button('工作区偏好').click());
 const exportButton=[...host.querySelectorAll('button')].find(node=>node.textContent.includes('导出本机备份'));
 await act(async()=>{exportButton.click();exportButton.click();});
 expect(mocks.save).toHaveBeenCalledOnce();
 expect(host.querySelector('.toast-warning').textContent).toContain('备份文件已保存：settings-backup.json');
 expect(host.querySelector('.system-operation-warning').textContent).toContain('备份文件已保存');
  expect(host.textContent).not.toContain('备份导出失败');
});
