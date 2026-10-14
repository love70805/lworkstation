import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Modal } from './UI';

export default function ImportLeaveGuard({ pending, committing }) {
  const protect = pending || committing;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => protect
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`);
  useEffect(() => {
    if (!protect) return undefined;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [protect]);
  useEffect(() => {
    // A completed or canceled import stays on its result page for review.
    if (!protect && blocker.state === 'blocked') blocker.reset();
  }, [protect, blocker]);
  return <Modal open={protect && blocker.state === 'blocked'} title={committing ? '台账正在导入' : '本次导入尚未完成'}
    description={committing ? '请等待本次写入完成；如需取消，请返回导入页使用取消操作，等待整批回滚。' : '离开会放弃本次文件、字段映射和货号筛选准备。继续准备会保留当前选择。'}
    onClose={() => blocker.reset?.()}
    footer={<><Button onClick={() => blocker.reset?.()}>{committing ? '返回导入' : '继续准备'}</Button><Button variant="danger" disabled={committing} onClick={() => blocker.proceed?.()}>放弃准备并离开</Button></>} />;
}
