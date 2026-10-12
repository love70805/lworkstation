// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkspacePreferenceRecoveryGate from './WorkspacePreferenceRecoveryGate';
import { setWorkspaceRecoveryError } from '../lib/workspaceBackgroundTasks';
const mocks = vi.hoisted(() => ({ recover: vi.fn() }));
vi.mock('../data/repositories/workspaceRepository', () => ({ recoverWorkspacePreferenceRestore: mocks.recover }));
let element, root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; setWorkspaceRecoveryError(); mocks.recover.mockReset();
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); setWorkspaceRecoveryError(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
it('holds pages until recovery completes and hides them again if restoration needs repair', async () => {
  let finish;
  mocks.recover.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<WorkspacePreferenceRecoveryGate><p>business page</p></WorkspacePreferenceRecoveryGate>));
  expect(element.textContent).not.toContain('business page');
  await act(async () => finish());
  expect(element.textContent).toContain('business page');
  await act(async () => setWorkspaceRecoveryError('fixture recovery failure'));
  expect(element.textContent).not.toContain('business page');
  expect(element.textContent).toContain('fixture recovery failure');
  mocks.recover.mockImplementation(async () => { setWorkspaceRecoveryError(); });
  await act(async () => element.querySelector('button').click());
  expect(element.textContent).toContain('business page');
});
it('shows startup recovery failure without mounting the business surface', async () => {
  mocks.recover.mockRejectedValue(Error('storage unavailable'));
  await act(async () => root.render(<WorkspacePreferenceRecoveryGate><p>business page</p></WorkspacePreferenceRecoveryGate>));
  expect(element.querySelector('[role=alert]').textContent).toContain('storage unavailable');
  expect(element.textContent).not.toContain('business page');
});
