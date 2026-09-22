// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AppShell from './AppShell';
import { ToastProvider } from './UI';
const mocks = vi.hoisted(() => ({
  check: { status: 'error', data: null, error: '本机读取失败样例', checkedAt: '2026-09-22T00:00:00Z', refreshing: false, refresh: vi.fn() },
}));
vi.mock('../hooks/useSystemSnapshot', () => ({ useSystemSnapshot: () => mocks.check }));
vi.mock('../hooks/useCloudAuth', () => ({ useCloudAuth: () => ({ user: null }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => null }));
vi.mock('../data/database', () => ({ db: {}, getActiveMemberContext: vi.fn(), getWorkspaceOperationalSummary: vi.fn(), createWorkspaceBackupPayload: vi.fn(), recordWorkspaceBackupExport: vi.fn() }));
vi.mock('./CloudAuthDialog', () => ({ default: () => null }));
let root, container, desktop;
const click = async label => {
  const target = [...container.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  expect(target, label).toBeTruthy();
  await act(async () => target.click());
};
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); vi.clearAllMocks();
  mocks.check.refresh.mockResolvedValue({ status: 'error', error: mocks.check.error });
  desktop = { desktop: true, getCloseBehavior: vi.fn().mockResolvedValue({ ok: true, closeBehavior: 'tray', trayAvailable: true }), setCloseBehavior: vi.fn().mockResolvedValue({ ok: true, closeBehavior: 'quit', trayAvailable: true }), onCloseBehavior: vi.fn(() => () => {}) };
  window.shopeersDesktopRuntime = desktop;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><ToastProvider><AppShell><p>fixture</p></AppShell></ToastProvider></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete window.shopeersDesktopRuntime; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

it('opens diagnostics directly and retains the actual failed connection result on retry', async () => {
  expect(container.querySelector('a[href="/diagnostics"]').textContent).toContain('系统与备份');
  await act(async () => container.querySelector('.environment-chip').click());
  const menu = container.querySelector('.environment-popover');
  expect(menu.textContent).toContain('检查失败');
  expect(menu.textContent).not.toContain('已连接');
  await click('重新检查连接');
  expect(mocks.check.refresh).toHaveBeenCalledOnce();
  expect(menu.querySelector('[role=alert]').textContent).toContain(mocks.check.error);
});

it('edits desktop close behavior from preferences and keeps cloud setup folded', async () => {
  await click('打开账户菜单');
  expect(container.querySelector('.account-popover').textContent).not.toContain('登录云端工作区');
  await click('工作区偏好');
  expect(desktop.getCloseBehavior).toHaveBeenCalledOnce();
  const select = container.querySelector('#desktop-close-behavior');
  expect(select.value).toBe('tray');
  await act(async () => { select.value = 'quit'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(desktop.setCloseBehavior).toHaveBeenCalledWith('quit');
  expect(select.value).toBe('quit');
  expect(container.querySelector('[role=dialog]').textContent).toContain('退出应用并停止后台收件');
  expect(container.querySelector('[role=dialog] .system-advanced').open).toBe(false);
});
