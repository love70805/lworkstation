import { useEffect, useState, useSyncExternalStore } from 'react';
import { recoverWorkspacePreferenceRestore } from '../data/repositories/workspaceRepository';
import { getWorkspaceRecoveryError, subscribeWorkspaceRecovery } from '../lib/workspaceBackgroundTasks';
import { Button, Panel } from './UI';

// Resolve an interrupted database/preferences transaction before any page reads
// business preferences or starts a background delivery cycle.
export default function WorkspacePreferenceRecoveryGate({ children }) {
  const failure = useSyncExternalStore(subscribeWorkspaceRecovery, getWorkspaceRecoveryError);
  const [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    recoverWorkspacePreferenceRestore().then(() => { if (active) setReady(true); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [attempt]);
  if (failure || error) return <main className="route-loader"><Panel role="alert">
    <h1>恢复检查尚未完成</h1><p>{failure || error}</p>
    <Button onClick={() => { setReady(false); setError(''); setAttempt(value => value + 1); }}>重试恢复检查</Button>
  </Panel></main>;
  if (!ready) return <main className="route-loader" role="status">正在检查本机恢复状态…</main>;
  return children;
}
