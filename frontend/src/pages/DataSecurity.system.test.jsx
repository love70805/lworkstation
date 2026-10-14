// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataSecurity from './DataSecurity';
import { ToastProvider } from '../components/UI';

const mocks = vi.hoisted(() => ({
  snapshot: { status: 'ready', data: { security: { summary: { recordCount: 3 }, securityEvents: [] }, storage: { usage: 12, quota: 100 } }, checkedAt: '2026-09-22T00:00:00Z', refreshing: false, refresh: vi.fn() },
  create: vi.fn(), record: vi.fn(), restore: vi.fn(), applied: vi.fn(), cloudRestore: vi.fn(), save: vi.fn(),
}));
vi.mock('../components/AppShell', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../hooks/useSystemSnapshot', () => ({ useSystemSnapshot: () => mocks.snapshot }));
vi.mock('../data/database', () => ({
  db: { tables: [] }, DEFAULT_WORKSPACE_ID: 'fixture', getDataSecuritySnapshot: vi.fn(),
  createWorkspaceBackupPayload: mocks.create, recordWorkspaceBackupExport: mocks.record,
  restoreWorkspaceBackupPayload: mocks.restore, restoreWorkspaceSyncRecoveryPayload: mocks.cloudRestore,
  inspectWorkspaceBackupPayload: () => ({ recordCount: 1 }),
  clearLocalWorkspaceData: vi.fn(), createWorkspaceCloudSeedPayload: vi.fn(), recordCloudSeedImportReceipt: vi.fn(),
}));
vi.mock('../domain/workspaceBackup', () => ({ validateWorkspaceBackupPayload: () => ({ recordCount: 1 }) }));
vi.mock('../data/cloudSeedProvider', () => ({ createCloudSeedProvider: vi.fn() }));
vi.mock('../data/syncProvider', () => ({ createSyncProvider: vi.fn() }));

let container, root;
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
async function chooseRestore() {
  const input = container.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'fixture.json', size: 12, text: async () => '{}' }] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear();
  mocks.create.mockResolvedValue({ format: 'shopeers-local-backup', formatVersion: 1, tables: {}, recordCount: 3 });
  mocks.restore.mockImplementation(async (_payload, _actor, options) => { await options?.beforeRestore?.(); mocks.applied(); return { recordCount: 1 }; });
  mocks.record.mockResolvedValue({});
  mocks.snapshot.refresh.mockResolvedValue({ status: 'ready' });
  window.shopeersDesktopRuntime = { desktop: true, saveBackup: mocks.save };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={['/data-security']}><ToastProvider><DataSecurity /></ToastProvider></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete window.shopeersDesktopRuntime; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('backup workflow save protection', () => {
  it.each([{ status: 'canceled' }, { status: 'failed', error: '磁盘已满' }])('keeps restoration and export records untouched for $status', async receipt => {
    mocks.save.mockResolvedValue(receipt);
    await chooseRestore();
    await act(async () => button('恢复备份').click());
    expect(mocks.applied).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    expect(container.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  });

  it('waits for actual save success before restoring and recording the rollback backup', async () => {
    let finish;
    mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await chooseRestore();
    await act(async () => button('恢复备份').click());
    expect(mocks.applied).not.toHaveBeenCalled();
    expect(button('恢复备份').disabled).toBe(true);
    await act(async () => finish({ status: 'saved', fileName: 'rollback.json', sizeBytes: 20 }));
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'rollback.json' }));
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });

  it('does not register canceled ordinary exports and runs a real refresh callback', async () => {
    mocks.save.mockResolvedValue({ status: 'canceled' });
    await act(async () => button('导出本机备份').click());
    expect(mocks.record).not.toHaveBeenCalled();
    await act(async () => button('刷新').click());
    expect(mocks.snapshot.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('.system-advanced').open).toBe(false);
    expect(container.querySelector('.system-navigation a[href="/diagnostics"]')).not.toBeNull();
  });
});

 it('reports a saved file accurately when registering its record fails', async () => {
  mocks.save.mockResolvedValue({ status: 'saved', fileName: 'saved.json', sizeBytes: 20 });
  mocks.record.mockRejectedValueOnce(new Error('登记失败样例'));
  await act(async () => button('导出本机备份').click());
  expect(container.querySelector('.toast-warning').textContent).toContain('备份文件已保存：saved.json');
  expect(container.querySelector('.system-operation-warning').textContent).toContain('备份文件已保存');
  expect(container.textContent).not.toContain('备份导出失败');
 });
 it('closes a committed restoration even when its rollback record fails, without inviting a second restore', async () => {
  mocks.save.mockResolvedValue({ status: 'saved', fileName: 'rollback.json', sizeBytes: 20 });
  mocks.record.mockRejectedValueOnce(new Error('登记失败样例'));
  await chooseRestore();
  await act(async () => button('恢复备份').click());
  expect(mocks.applied).toHaveBeenCalledOnce();
  expect(container.querySelector('[role=dialog]')).toBeNull();
  expect(container.querySelector('.toast-warning').textContent).toContain('备份已恢复，共写入 1 条记录');
  expect(container.querySelector('.toast-warning').textContent).toContain('无需重复恢复');
  expect(container.querySelector('.system-operation-warning').textContent).toContain('无需重复恢复');
  expect(container.textContent).not.toContain('备份恢复失败');
 });
 it('prevents the two export controls from submitting the same save twice', async () => {
  let finish;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  await act(async () => { button('导出本机备份').click(); button('导出完整备份').click(); });
  expect(mocks.create).toHaveBeenCalledOnce();expect(mocks.save).toHaveBeenCalledOnce();
  await act(async () => finish({ status: 'saved', fileName: 'once.json', sizeBytes: 20 }));
  expect(mocks.record).toHaveBeenCalledOnce();
 });
 it('prevents a same-event duplicate restoration before React disables the button', async () => {
  let finish;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  await chooseRestore();
  await act(async () => { button('恢复备份').click(); button('恢复备份').click(); });
  expect(mocks.restore).toHaveBeenCalledOnce();
  await act(async () => finish({ status: 'saved', fileName: 'rollback.json', sizeBytes: 20 }));
  expect(mocks.applied).toHaveBeenCalledOnce();
 });
