// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { requestErpInboxRefresh, subscribeErpInboxRefresh, erpInboxRecoveryInterval } from './erpInboxEvents';
it('subscribes to trusted desktop notifications, permits explicit retry, retains fallback and cleans up', () => {
  let changed;
  const dispose=vi.fn(), callback=vi.fn();
  window.shopeersDesktopRuntime={onInboxChanged:fn=>{changed=fn;return dispose;}};
  const remove=subscribeErpInboxRefresh(callback);
  expect(erpInboxRecoveryInterval()).toBe(30000);
  changed();requestErpInboxRefresh();
  expect(callback).toHaveBeenCalledTimes(2);
  remove();requestErpInboxRefresh();
  expect(callback).toHaveBeenCalledTimes(2);expect(dispose).toHaveBeenCalledOnce();
  delete window.shopeersDesktopRuntime;
  expect(erpInboxRecoveryInterval()).toBe(5000);
});
