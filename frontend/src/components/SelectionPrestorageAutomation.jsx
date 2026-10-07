import { useEffect, useRef } from 'react';
import { getSelectionPrestorageSnapshot, promoteSelectionPrestorageRecords } from '../data/repositories/selectionRepository';
import { useSelectionRead } from './SelectionReadState';
import { useToast } from './UI';

export default function SelectionPrestorageAutomation() {
  const read = useSelectionRead(getSelectionPrestorageSnapshot);
  const { notify } = useToast();
  const attempted = useRef(new Map());
  const pending = useRef(null), running = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const retry = () => { attempted.current.clear(); read.retry(); };
    window.addEventListener('lworkstation:retry-prestorage', retry);
    return () => window.removeEventListener('lworkstation:retry-prestorage', retry);
  }, [read.retry]);
  useEffect(() => {
    if (read.status !== 'ready') return;
    pending.current = read.data;
    if (running.current) return;
    running.current = true;
    void (async () => {
      try {
        while (mounted.current && pending.current) {
          const snapshot = pending.current; pending.current = null;
          const ready = snapshot.products.filter(product => {
            if (!product.autoPromote || !product.readiness.ready) return false;
            const key = `${snapshot.workspaceId}:${product.id}`;
            const fingerprint = JSON.stringify([product.updatedAt, product.draft, product.prefill]);
            if (attempted.current.get(key) === fingerprint) return false;
            attempted.current.set(key, fingerprint); return true;
          });
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
      } finally { running.current = false; }
    })();
  }, [read.data, read.status, notify]);
  return null;
}
