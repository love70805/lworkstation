// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { requestInbox } from './inboxTransport';
import { listErpCollectionTasks } from './erpInboxTransport';
import { publishErpCollectionActivity, readErpCollectionActivity } from './erpCollectionActivity';
import { erpCollectionPresentation } from '../domain/erpCollectionStatus';
vi.mock('./inboxTransport', () => ({ requestInbox: vi.fn() }));
afterEach(() => { delete window.shopeersDesktopRuntime; });

it('projects a login wait into the notice and details only for the matching queued desktop task', async () => {
  const task = { workspaceId:'LOGIN-W', requestId:'REQ', taskId:'T', status:'ready', executionProtocol:2, executionTarget:'desktop', batches:[{status:'pending',platformSkcs:['A']}] };
  const stored = [task, {...task, taskId:'OTHER', requestId:'OLD'}];
  requestInbox.mockResolvedValue({tasks:stored});
  window.shopeersDesktopRuntime = {getErpCollection:async()=>({requestId:'REQ', taskId:'T', status:'waiting_login'})};
  const {tasks}=await listErpCollectionTasks({workspaceId:task.workspaceId});
  publishErpCollectionActivity({workspaceId:task.workspaceId,tasks});
  for(const rows of [tasks,readErpCollectionActivity(task.workspaceId).tasks]) {
    expect(erpCollectionPresentation(rows[0])).toMatchObject({state:'waiting_login',running:false});
    expect(erpCollectionPresentation(rows[1])).toMatchObject({state:'queued',running:false});
    expect(erpCollectionPresentation(rows[1]).description).not.toContain('采购管理页已打开');
  }
  expect(task).not.toHaveProperty('desktopStatus');
  expect(erpCollectionPresentation({...tasks[0],status:'stopped'}).state).toBe('stopped');
  expect(erpCollectionPresentation({...tasks[0],status:'paused'}).state).not.toBe('waiting_login');
});
