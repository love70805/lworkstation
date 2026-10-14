import { afterEach, expect, it, vi } from 'vitest';
import { publishWorkspaceInboxContext } from './erpInboxTransport';
import { setInboxTransportForTests } from './inboxTransport';
afterEach(() => setInboxTransportForTests(null));
it('synchronizes workspace and member through the independent ERP seam without secrets or capture APIs', async () => {
 const transport=vi.fn(async () => ({ status: 200, body: { ok: true } }));
 setInboxTransportForTests(transport);
 await publishWorkspaceInboxContext({ workspaceId: 'scope-a', memberId: 'member-a', canSeeAllSelection: false });
 expect(transport).toHaveBeenCalledWith({ route: '/erp/v1/workspace-context', method: 'POST', query: {}, body: { workspaceId: 'scope-a', memberId: 'member-a', visibility: 'private' } });
 await publishWorkspaceInboxContext({ workspaceId: 'scope-b', memberId: 'member-b', canSeeAllSelection: true });
 expect(transport.mock.calls[1][0].body.visibility).toBe('workspace');
 expect(JSON.stringify(transport.mock.calls)).not.toMatch(/selection|127.0.0.1|capability|Bearer/);
});
