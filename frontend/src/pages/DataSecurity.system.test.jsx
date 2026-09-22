// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataSecurity from './DataSecurity';
import { ToastProvider } from '../components/UI';

const mocks = vi.hoisted(() => ({
  snapshot: { status: 'ready', data: { security: { summary: { recordCount: 3 }, securityEvents: [] }, storage: { usage: 12, quota: 100 } }, checkedAt: '2026-09-22T00:00:00Z', refreshing: false, refresh: vi.fn() },
  create: vi.fn(), record: vi.fn(), restore: vi.fn(), cloudRestore: vi.fn(), save: vi.fn(),
}));
vi.mock('../components/AppShell', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../hooks/useSystemSnapshot', () => ({ useSystemSnapshot: () => mocks.snapshot }));
vi.mock('../data/database', () => ({
  db: { tables: [] }, DEFAULT_WORKSPACE_ID: 'fixture', getDataSecuritySnapshot: vi.fn(),
  createWorkspaceBackupPayload: mocks.create, recordWorkspaceBackupExport: mocks.record,
  restoreWorkspaceBackupPayload: mocks.restore, restoreWorkspaceSyncRecoveryPayload: mocks.cloudRestore,
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
  mocks.restore.mockResolvedValue({ recordCount: 1 });
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
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    expect(container.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  });

  it('waits for actual save success before restoring and recording the rollback backup', async () => {
    let finish;
    mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await chooseRestore();
    await act(async () => button('恢复备份').click());
    expect(mocks.restore).not.toHaveBeenCalled();
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
