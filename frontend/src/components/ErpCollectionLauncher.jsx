import { useEffect, useState } from 'react';
import { Button } from './UI';
import { erpCollectionPresentation } from '../domain/erpCollectionStatus';

export default function ErpCollectionLauncher({ workspaceId, ledgerId, requestId, ready, task, onStarted, onRegistrationRetry, mode = 'cost', onStart }) {
  const runtime = globalThis.window?.shopeersDesktopRuntime;
  const [state,setState] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(() => {
    if (!runtime?.getErpCollection) return;
    let active=true, polling=false;
    const read=async()=>{if(polling)return;polling=true;try{const result=await runtime.getErpCollection();if(active)setState(result);}catch{ /* Collection progress retains transport errors. */ }finally{polling=false;}};
    void read();const timer=setInterval(read,3000);
    return()=>{active=false;clearInterval(timer);};
  },[runtime,requestId]);
  if (!runtime?.startErpCollection) return null;
  const current=state?.requestId===requestId?state:null;
  const terminalTask=Boolean(task)&&task.requestId===requestId&&['stopped','invalidated'].includes(task.status);
  const connecting=['starting','waiting_ack','reconnecting','ready'].includes(current?.status);
  const taskView=erpCollectionPresentation(task?.requestId===requestId ? task : null);
  const running=!terminalTask&&(connecting||current?.status==='running'||taskView.running||taskView.state==='queued');
  const completed=task?.requestId===requestId&&task?.batches?.length&&task.batches.every(batch=>batch.deliveryId);
  const catalog = mode === 'catalog';
  const catalogCompleted = catalog && task?.batches?.length && task.batches.every(batch => batch.catalogStatus === 'completed');
  async function start(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      let result=onStart ? await onStart() : await runtime.startErpCollection({workspaceId,ledgerId,requestId,retryFailed:true});
      if(!result?.ok){
        const request=await onRegistrationRetry?.({...result,requestId});
        if(request?.id&&request.id!==requestId) result=await runtime.startErpCollection({workspaceId,ledgerId,requestId:request.id,retryFailed:true});
        if(!result?.ok)throw new Error(result?.error||'采集尚未启动，请重试。');
      }
      setState(result);onStarted?.();
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  return <div className="erp-workspace-launcher">
    <Button variant="primary" loading={busy} disabled={busy||!ready||running||(!catalog && Boolean(completed))} onClick={start}>{connecting?'正在连接 ERP':catalog ? running?'正在获取商品档案':current?.status==='sync_error'?'重新连接 ERP':catalogCompleted?'重新获取商品档案':task?.runMode==='catalog'?'继续获取商品档案':'一键获取商品档案':completed?'成本已采集':running?'正在采集成本':current?.status==='sync_error'?'重新连接 ERP':task?'继续成本核算':'开始成本核算'}</Button>
    {connecting&&!terminalTask?<span role="status">任务已发出，正在等待 ERP 确认接收。</span>:null}
    {current?.status==='sync_error'&&!terminalTask?<span role="alert">{current.error||'ERP 接收暂未确认，请重新连接；已送达结果保留。'}</span>:null}
    {current?.status==='waiting_login'&&!terminalTask?<><span role="status">等待 ERP 登录，登录后自动继续本次采集。</span><Button onClick={()=>runtime.openErpLogin()}>登录 ERP</Button></>:null}
    {current?.status==='session_changed'||terminalTask?<span role="status">旧任务已停止，已收到的结果保留；请登录 ERP 后重新确认{catalog ? '商品范围' : '成本核算范围'}。</span>:null}
    {error?<span role="alert">{error}</span>:null}
  </div>;
}
