// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Diagnostics from './Diagnostics';
import { ToastProvider } from '../components/UI';
const mocks = vi.hoisted(() => ({ check: { status: 'error', data: null, error: '读取失败样例', checkedAt: '2026-09-22T00:00:00Z', refreshing: false, refresh: vi.fn() } }));
vi.mock('../hooks/useSystemSnapshot', () => ({ useSystemSnapshot: () => mocks.check }));
vi.mock('../components/AppShell', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../components/ErpAssistantSetup', () => ({ default: () => <div>ERP 连接状态</div> }));
vi.mock('../components/SelectionCaptureSetup', () => ({ default: () => <div>1688 连接状态</div> }));
let root, container;
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.check.refresh.mockResolvedValue({ status: 'error', error: mocks.check.error });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={['/diagnostics']}><ToastProvider><Diagnostics /></ToastProvider></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

it('keeps failed checks visible without presenting missing data as healthy or empty', async () => {
  expect(container.querySelector('[role=alert]').textContent).toContain('读取失败样例');
  expect(container.querySelector('.system-local-cards').textContent).toContain('检查失败');
  expect(container.querySelector('.system-local-cards').textContent).not.toContain('尚未导出');
  expect(container.querySelector('.system-local-cards').textContent).not.toContain('0 B');
  expect(container.querySelector('.system-navigation a[href="/data-security"]')).not.toBeNull();
  const retry = [...container.querySelectorAll('button')].find(item => item.textContent === '重试检查');
  await act(async () => retry.click());
  expect(mocks.check.refresh).toHaveBeenCalledOnce();
  expect(container.querySelector('.system-advanced').open).toBe(false);
});
