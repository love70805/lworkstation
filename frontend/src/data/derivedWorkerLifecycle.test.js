import { afterEach, expect, it, vi } from 'vitest';
import { runDerivedComputation, disposeIdleDerivedWorkers } from './repositories/derivedComputationService';

afterEach(() => { disposeIdleDerivedWorkers(); vi.unstubAllGlobals(); });
function workers({ failPost = false } = {}) {
  const instances = [];
  vi.stubGlobal('Worker', class {
    constructor() { this.terminate = vi.fn(); instances.push(this); }
    postMessage() { if (failPost) throw new Error('cannot clone'); }
  });
  return instances;
}

it('terminates superseded work and ignores its late response', async () => {
  const instances = workers(), controller = new AbortController();
  const pending = runDerivedComputation('cost-reconciliation', {}, { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  instances[0].onmessage({ data: { value: 'late' } });
  expect(instances[0].terminate).toHaveBeenCalledTimes(1);
});

it('releases the worker on a synchronous clone failure and never starts pre-cancelled work', async () => {
  const instances = workers({ failPost: true });
  await expect(runDerivedComputation('cost-reconciliation', {})).rejects.toThrow('cannot clone');
  expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  const controller = new AbortController(); controller.abort();
  await expect(runDerivedComputation('cost-reconciliation', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(instances).toHaveLength(1);
});

it('finishes parallel workers independently and removes the completed cancellation listener', async () => {
  const instances = workers(), controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const first = runDerivedComputation('cost-reconciliation', {}, { signal: controller.signal });
  const second = runDerivedComputation('cost-coverage', {}, { signal: controller.signal });
  instances[0].onmessage({ data: { value: 1 } }); expect(await first).toBe(1);
  expect(remove).toHaveBeenCalledTimes(1);
  instances[1].onmessage({ data: { value: 2 } }); expect(await second).toBe(2);
  controller.abort();
  instances.forEach(worker => expect(worker.terminate).not.toHaveBeenCalled());
  disposeIdleDerivedWorkers();
  instances.forEach(worker => expect(worker.terminate).toHaveBeenCalledTimes(1));
});

it('reuses an initialized worker, reports progress without resolving and rejects stale job messages', async () => {
  const instances = workers();
  const first = runDerivedComputation('cost-coverage', {});
  instances[0].onmessage({data:{value:1}});await first;
  const onProgress=vi.fn();
  const next=runDerivedComputation('profit',{}, {onProgress});
  expect(instances).toHaveLength(1);
  instances[0].onmessage({data:{type:'progress',progress:{label:'正在核算'}}});
  expect(onProgress).toHaveBeenCalledWith({label:'正在核算'});
  instances[0].onmessage({data:{jobId:-1,value:'stale'}});
  instances[0].onmessage({data:{value:2}});expect(await next).toBe(2);
});
