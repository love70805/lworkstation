import { useEffect, useRef } from 'react';
import { getSelectionPrestorageAutomationSnapshot, promoteSelectionPrestorageRecords } from '../data/repositories/selectionRepository';
import { useSelectionRead } from './SelectionReadState';
import { useToast } from './UI';
import { runWorkspaceBackgroundTask, subscribeWorkspaceResumed } from '../lib/workspaceBackgroundTasks';
import { prestorageAttemptFingerprint } from '../lib/prestorageAttemptFingerprint';

export default function SelectionPrestorageAutomation() {
  const read = useSelectionRead(getSelectionPrestorageAutomationSnapshot);
  const { notify } = useToast();
  const attempted = useRef(new Map());
  const pending = useRef(null), running = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const retry = () => { attempted.current.clear(); read.retry(); };
    window.addEventListener('lworkstation:retry-prestorage', retry);
    const unsubscribe = subscribeWorkspaceResumed(retry);
    return () => { unsubscribe(); window.removeEventListener('lworkstation:retry-prestorage', retry); };
  }, [read.retry]);
  useEffect(() => {
    if (read.status !== 'ready') return;
    pending.current = read.data;
    if (running.current) return;
    running.current = true;
    void runWorkspaceBackgroundTask(async () => {
      while (mounted.current && pending.current) {
        const snapshot = pending.current; pending.current = null;
        const ready = [];
        for (const product of snapshot.products) {
          if (!product.autoPromote || !product.readiness.ready) continue;
          const key = `${snapshot.workspaceId}:${product.id}`;
          const fingerprint = product.fingerprint ?? await prestorageAttemptFingerprint(product);
          if (attempted.current.get(key) === fingerprint) continue;
          attempted.current.set(key, fingerprint); ready.push(product);
        }
        for (let index = 0; mounted.current && index < ready.length; index += 20) {
          try {
            await promoteSelectionPrestorageRecords({ productIds: ready.slice(index, index + 20).map(product => product.id), expectedWorkspaceId: snapshot.workspaceId });
          } catch (error) {
            if (mounted.current) notify(`预存资料自动进入选品库失败：${error.message}。可在预存区重新检查。`, 'error');
          }
        }
        const currentIds = new Set(snapshot.products.map(product => `${snapshot.workspaceId}:${product.id}`));
        for (const key of attempted.current.keys()) if (!currentIds.has(key)) attempted.current.delete(key);
      }
    }).finally(() => { running.current = false; });
  }, [read.data, read.status, notify]);
  return null;
}
