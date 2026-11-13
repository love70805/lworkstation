import { expect, it, vi } from 'vitest';
import { prepareCostRecollection, runCostRecollection } from './erpCostRecollection';
import { ensureAutoErpRequest } from './autoErpRequest';

function fixture() {
  const input = { ledger: { id: 'L', workspaceId: 'W', period: '2034-06' }, ledgerVersion: 'IMPORT', platformSkcs: ['A'], expectedSkus: [{ platformSku: 'SKU', platformSkc: 'A', store: '甲' }] };
  const intent = prepareCostRecollection(input, { scopeKey: 'SCOPE', requestId: 'OLD', task: { taskId: 'T', requestId: 'OLD', workspaceId: 'W', ledgerId: 'L', status: 'completed' } });
  const deps = { isCurrent: vi.fn(() => true), stopTask: vi.fn(async () => {}), ensure: vi.fn(async () => ({ id: 'NEW' })),
    start: vi.fn(async () => ({ ok: true, requestId: 'NEW' })), onPrepared: vi.fn() };
  return { input, intent, deps };
}
it('does nothing until a confirmed intent runs and coalesces duplicate confirmations', async () => {
  const { input, intent, deps } = fixture();
  input.platformSkcs.push('UNCONFIRMED');
  expect(deps.stopTask).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([runCostRecollection(intent, deps), runCostRecollection(intent, deps)]);
  expect(a).toBe(b); expect(deps.stopTask).toHaveBeenCalledOnce(); expect(deps.ensure).toHaveBeenCalledOnce(); expect(deps.start).toHaveBeenCalledOnce();
  expect(deps.ensure).toHaveBeenCalledWith(expect.objectContaining({ platformSkcs: ['A'] }), expect.objectContaining({ rejectedRequestId: 'OLD' }));
  expect(deps.start).toHaveBeenCalledWith({ workspaceId: 'W', ledgerId: 'L', requestId: 'NEW', mode: 'cost', retryFailed: true });
});
it('retries the same prepared request after a launch failure without stopping again or deleting costs', async () => {
  const { intent, deps } = fixture();
  deps.start.mockResolvedValueOnce({ ok: false, error: 'offline' });
  await expect(runCostRecollection(intent, deps)).rejects.toThrow('offline');
  await runCostRecollection(intent, deps);
  expect(deps.stopTask).toHaveBeenCalledOnce(); expect(deps.ensure).toHaveBeenCalledOnce();
  expect(deps.start.mock.calls.map(([input]) => input.requestId)).toEqual(['NEW', 'NEW']);
});
it('rejects a changed confirmation before side effects and after asynchronous stopping or registration', async () => {
  for (const phase of ['before', 'stop', 'register']) {
    const { intent, deps } = fixture(); let current = phase !== 'before';
    deps.isCurrent.mockImplementation(() => current);
    if (phase === 'stop') deps.stopTask.mockImplementation(async () => { current = false; });
    if (phase === 'register') deps.ensure.mockImplementation(async () => { current = false; return { id: 'NEW' }; });
    await expect(runCostRecollection(intent, deps)).rejects.toThrow('已变化');
    expect(deps.start).not.toHaveBeenCalled();
    if (phase === 'before') expect(deps.stopTask).not.toHaveBeenCalled();
    if (phase !== 'register') expect(deps.ensure).not.toHaveBeenCalled();
  }
});
it('refuses a foreign old task and never launches the old request identity', async () => {
  const { input, intent, deps } = fixture();
  expect(() => prepareCostRecollection(input, { task: { workspaceId: 'OTHER', ledgerId: 'L' } })).toThrow('不属于');
  deps.ensure.mockResolvedValue({ id: 'OLD' });
  await expect(runCostRecollection(intent, deps)).rejects.toThrow('新的采集请求');
  expect(deps.start).not.toHaveBeenCalled();
});
it('replaces the latest registration once even when the task view still shows an older request', async () => {
  const { intent, deps } = fixture();
  deps.latest=vi.fn(async()=>({id:'LATEST'}));
  deps.start.mockRejectedValueOnce(new Error('offline'));
  await expect(runCostRecollection(intent,deps)).rejects.toThrow('offline');
  await runCostRecollection(intent,deps);
  expect(deps.latest).toHaveBeenCalledOnce();
  expect(deps.ensure).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({rejectedRequestId:'LATEST'}));
  expect(deps.ensure).toHaveBeenCalledOnce();
});
it('reuses the persisted new request when registration fails after local saving', async () => {
  const { input, deps } = fixture();
  let saved;
  const registration = { latest: vi.fn(async()=>saved), save: vi.fn(async request=>{saved=request;}), register: vi.fn(async()=>({accepted:true,status:'registered'})) };
  const old = await ensureAutoErpRequest(input, registration);
  const intent = prepareCostRecollection(input, {scopeKey:'SCOPE',requestId:old.id});
  registration.register.mockRejectedValueOnce(new Error('registration offline'));
  const options={...deps,...registration,ensure:ensureAutoErpRequest};
  await expect(runCostRecollection(intent,options)).rejects.toThrow('registration offline');
  const preparedId=saved.id;expect(preparedId).not.toBe(old.id);
  await runCostRecollection(intent,options);
  expect(saved.id).toBe(preparedId);
  expect(deps.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({requestId:preparedId}));
});
