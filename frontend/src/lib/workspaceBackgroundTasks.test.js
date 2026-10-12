import { afterEach, expect, it, vi } from 'vitest';
import { getWorkspaceRecoveryError, runWorkspaceBackgroundTask, setWorkspaceRecoveryError, withWorkspaceReset } from './workspaceBackgroundTasks';
afterEach(() => setWorkspaceRecoveryError());
it('drains both successful and failed work and rejects overlapping replacements', async () => {
  let release;
  const pending = runWorkspaceBackgroundTask(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const write = vi.fn();
  const restore = withWorkspaceReset(write);
  expect(await runWorkspaceBackgroundTask(vi.fn())).toBeNull();
  await expect(withWorkspaceReset(vi.fn())).rejects.toThrow('恢复或清空');
  expect(write).not.toHaveBeenCalled();
  release(); await pending; await restore;
  expect(write).toHaveBeenCalledOnce();
  expect(await runWorkspaceBackgroundTask(() => 'resumed')).toBe('resumed');
});
it('releases the replacement lock after failure but respects unresolved recovery', async () => {
  await expect(withWorkspaceReset(() => { throw Error('fixture'); })).rejects.toThrow('fixture');
  expect(await runWorkspaceBackgroundTask(() => 1)).toBe(1);
  setWorkspaceRecoveryError('needs recovery');
  expect(getWorkspaceRecoveryError()).toBe('needs recovery');
  expect(await runWorkspaceBackgroundTask(() => 2)).toBeNull();
  await withWorkspaceReset(() => setWorkspaceRecoveryError());
  expect(await runWorkspaceBackgroundTask(() => 3)).toBe(3);
});
