// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupSaveMessage, downloadWorkspaceBackup, requireSavedWorkspaceBackup } from './workspaceBackupDownload';

const payload = { format: 'shopeers-local-backup', formatVersion: 1, tables: {}, generatedAt: '2026-09-22T00:00:00Z' };
afterEach(() => { delete window.shopeersDesktopRuntime; vi.restoreAllMocks(); });

describe('confirmed backup saves', () => {
  it('waits for the desktop save receipt and retains canceled/failed results', async () => {
    let finish;
    const saveBackup = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    window.shopeersDesktopRuntime = { desktop: true, saveBackup };
    let settled = false;
    const saving = downloadWorkspaceBackup(payload).then(result => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(JSON.parse(saveBackup.mock.calls[0][0].json)).toEqual(payload);
    finish({ status: 'saved', fileName: 'saved.json', sizeBytes: 100 });
    expect(requireSavedWorkspaceBackup(await saving).fileName).toBe('saved.json');
    for (const receipt of [{ status: 'canceled' }, { status: 'failed', error: '磁盘已满' }]) {
      saveBackup.mockResolvedValueOnce(receipt);
      expect(await downloadWorkspaceBackup(payload)).toEqual(receipt);
      expect(() => requireSavedWorkspaceBackup(receipt)).toThrow();
    }
  });

  it('does not claim a browser download is saved or permit it as a rollback receipt', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const result = await downloadWorkspaceBackup(payload);
    expect(result.status).toBe('requested');
    expect(backupSaveMessage(result)).toContain('未登记为已保存备份');
    expect(() => requireSavedWorkspaceBackup(result)).toThrow('浏览器无法确认');
  });

  it('fails closed on missing, rejected or invalid desktop bridge results', async () => {
    window.shopeersDesktopRuntime = { desktop: true };
    expect((await downloadWorkspaceBackup(payload)).status).toBe('failed');
    window.shopeersDesktopRuntime.saveBackup = vi.fn().mockRejectedValue(Error('IPC unavailable'));
    expect((await downloadWorkspaceBackup(payload)).status).toBe('failed');
    window.shopeersDesktopRuntime.saveBackup.mockResolvedValue({ status: 'requested' });
    expect((await downloadWorkspaceBackup(payload)).status).toBe('failed');
  });
});
