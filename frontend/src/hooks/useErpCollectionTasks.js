import { useCallback, useEffect, useState } from 'react';
import { listErpCollectionTasks } from '../lib/erpInboxTransport';

export function useErpCollectionTasks(workspaceId, ledgerId) {
  const key = `${workspaceId ?? ''}/${ledgerId ?? ''}`;
  const [state, setState] = useState({ key: '', tasks: [], error: '' });
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  useEffect(() => {
    if (!workspaceId || !ledgerId) return;
    let disposed = false, busy = false;
    const controller = new AbortController();
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const payload = await listErpCollectionTasks({ workspaceId, ledgerId, signal: controller.signal });
        if (!disposed) setState({ key, tasks: payload.tasks ?? payload.records ?? [], error: '' });
      } catch (error) {
        if (!disposed) setState(current => ({ key, tasks: current.key === key ? current.tasks : [], error: error.message }));
      } finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); };
  }, [key, retry]);
  return { tasks: state.key === key ? state.tasks : [], loading: Boolean(workspaceId && ledgerId && state.key !== key), error: state.key === key ? state.error : '', refresh };
}
