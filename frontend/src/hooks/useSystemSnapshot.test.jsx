// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSystemSnapshot } from './useSystemSnapshot';

let root, container, current;
function View({ read }) {
  current = useSystemSnapshot(read);
  return <div>{current.status}:{current.data?.count ?? '--'}:{current.error}</div>;
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

it('shows initial loading, actual refresh results, persistent failure and retry recovery', async () => {
  let count = 1;
  let broken = false;
  let initial;
  const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockImplementation(async () => {
    if (broken) throw Error('读取受阻');
    return { count };
  });
  await act(async () => root.render(<View read={read} />));
  expect(container.textContent).toContain('loading:--');
  await settle();
  await act(async () => initial({ count: 1 }));
  await settle();
  expect(container.textContent).toContain('ready:1');
  count = 7;
  await act(async () => current.refresh());
  await settle();
  expect(container.textContent).toContain('ready:7');
  broken = true;
  await act(async () => current.refresh());
  expect(container.textContent).toContain('error:--:读取受阻');
  expect(current.checkedAt).toBeTruthy();
  broken = false;
  count = 9;
  await act(async () => current.refresh());
  await settle();
  expect(container.textContent).toContain('ready:9');
});
