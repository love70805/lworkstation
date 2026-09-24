import { describe, expect, it, vi } from 'vitest';

vi.mock('./data/database', () => ({
  DEFAULT_WORKSPACE_ID: 'workspace-default',
  getActiveMemberContext: vi.fn(),
  receiveErpCostInboxEnvelope: vi.fn(),
  recoverErpCostInboxAdoptions: vi.fn(),
  receiveSelectionCaptureEnvelope: vi.fn(),
}));

import { createErpInboxPoller, runErpInboxCycle } from './App';

const envelope = id => ({ deliveryId: id });
const record = id => ({ deliveryId: id, envelope: envelope(id) });
const defaults = overrides => ({
  getContext: vi.fn(async () => ({ workspaceId: 'W1' })),
  pollRecords: vi.fn(async () => [record('bad'), record('good')]),
  parseRecord: vi.fn(value => ({ envelope: value })),
  receive: vi.fn(async ({ envelope: value }) => {
    if (value.deliveryId === 'bad') throw Error('invalid evidence');
    return { id: value.deliveryId };
  }),
  acknowledge: vi.fn(async () => {}),
  recover: vi.fn(async () => ({ recovered: true })),
  recoverDrafts: vi.fn(async () => ({ recovered: 0, failures: [] })),
  emit: vi.fn(),
  ...overrides,
});

describe('ERP inbox background delivery and adoption', () => {
  it('isolates a failed delivery, acknowledges only a saved record, then recovers', async () => {
    const calls = [];
    const options = defaults({
      receive: vi.fn(async ({ envelope: value }) => {
        calls.push(`save:${value.deliveryId}`);
        if (value.deliveryId === 'bad') throw Error('invalid evidence');
        return { id: value.deliveryId };
      }),
      acknowledge: vi.fn(async id => { calls.push(`ack:${id}`); }),
      recover: vi.fn(async scope => { calls.push(`recover:${scope.workspaceId}`); }),
    });
    const result = await runErpInboxCycle(options);
    expect(calls).toEqual(['save:bad', 'save:good', 'ack:good', 'recover:W1']);
    expect(result).toMatchObject({ received: 1, recovered: true });
    expect(result.failures).toHaveLength(1);
    expect(options.emit).toHaveBeenCalledOnce();
  });

  it('recovers acknowledged database records even when the transport is offline', async () => {
    const options = defaults({ pollRecords: vi.fn(async () => { throw Error('offline'); }) });
    const result = await runErpInboxCycle(options);
    expect(options.recover).toHaveBeenCalledWith({ workspaceId: 'W1' });
    expect(result).toMatchObject({ received: 0, recovered: true });
    expect(result.failures).toHaveLength(1);
  });

  it('keeps durable inbox recovery running when an old local draft cannot be inspected', async () => {
    const options = defaults({ pollRecords: vi.fn(async () => []), recoverDrafts: vi.fn(async () => { throw Error('draft read failed'); }) });
    const result = await runErpInboxCycle(options);
    expect(options.recover).toHaveBeenCalledWith({ workspaceId: 'W1' });
    expect(result).toMatchObject({ received: 0, recovered: true });
    expect(result.failures.map(error => error.message)).toEqual(['draft read failed']);
  });

  it('keeps a saved but unacknowledged record retryable while recovering the local inbox', async () => {
    const options = defaults({
      pollRecords: vi.fn(async () => [record('good')]),
      receive: vi.fn(async () => ({ id: 'good' })),
      acknowledge: vi.fn(async () => { throw Error('ACK offline'); }),
    });
    const result = await runErpInboxCycle(options);
    expect(result).toMatchObject({ received: 0, recovered: true });
    expect(result.failures).toHaveLength(1);
    expect(options.recover).toHaveBeenCalledWith({ workspaceId: 'W1' });
    expect(options.emit).not.toHaveBeenCalled();
  });

  it('retries adoption next cycle without receiving or acknowledging the same delivery', async () => {
    const options = defaults({
      pollRecords: vi.fn(async () => [record('good')]),
      receive: vi.fn(async () => ({ id: 'good' })),
      recover: vi.fn().mockRejectedValueOnce(Error('transaction failed')).mockResolvedValueOnce({ recovered: true }),
    });
    const first = await runErpInboxCycle(options);
    expect(first).toMatchObject({ received: 1, recovered: false });
    options.pollRecords.mockResolvedValueOnce([]);
    const second = await runErpInboxCycle(options);
    expect(second).toMatchObject({ received: 0, recovered: true });
    expect(options.acknowledge).toHaveBeenCalledTimes(1);
    expect(options.recover).toHaveBeenCalledTimes(2);
  });

  it('runs one cycle at a time and stops starting work after disposal', async () => {
    let release;
    let disposed = false;
    const options = defaults({
      pollRecords: vi.fn(() => new Promise(resolve => { release = resolve; })),
      isDisposed: () => disposed,
    });
    const poll = createErpInboxPoller(options);
    const first = poll();
    await vi.waitFor(() => expect(options.pollRecords).toHaveBeenCalledOnce());
    expect(await poll()).toBeNull();
    release([]);
    await first;
    expect(options.recover).toHaveBeenCalledOnce();
    disposed = true;
    expect(await poll()).toBeNull();
    expect(options.pollRecords).toHaveBeenCalledOnce();
  });
});
