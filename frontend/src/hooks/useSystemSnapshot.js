import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';

// Use the same read for live updates and explicit checks. Failed reads are
// visible and a manual retry also restarts the subscription if it has failed.
export function useSystemSnapshot(read) {
  const [snapshot, setSnapshot] = useState({ status: 'loading', data: null, error: '', checkedAt: null });
  const [refreshing, setRefreshing] = useState(false);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const mounted = useRef(false);
  const request = useRef(0);
  const refreshPending = useRef(false);
  const run = useCallback(async () => {
    const id = ++request.current;
    let result;
    try { result = { status: 'ready', data: await read(), error: '', checkedAt: new Date().toISOString() }; }
    catch (error) { result = { status: 'error', data: null, error: error.message || '本机读取失败。', checkedAt: new Date().toISOString() }; }
    return { ...result, id };
  }, [read]);
  const apply = useCallback(result => {
    if (mounted.current && result.id === request.current) setSnapshot(result);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const subscription = liveQuery(run).subscribe({ next: apply });
    return () => { mounted.current = false; request.current++; subscription.unsubscribe(); };
  }, [run, apply, subscriptionKey]);
  const refresh = useCallback(async () => {
    if (refreshPending.current) return null;
    refreshPending.current = true;
    setRefreshing(true);
    try {
      const result = await run();
      apply(result);
      if (mounted.current && snapshot.status === 'error' && result.status === 'ready') setSubscriptionKey(key => key + 1);
      return result;
    } finally {
      refreshPending.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [run, apply, snapshot.status]);
  return { ...snapshot, refreshing, refresh };
}
