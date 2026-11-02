import { useEffect, useState } from 'react';
import { Button } from './UI';

export default function ErpCollectionLauncher({ workspaceId, ledgerId, requestId, ready, task, onStarted, onRegistrationRetry }) {
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
  const running=['starting','running','ready'].includes(current?.status)&&!current?.error;
  const completed=task?.batches?.length&&task.batches.every(batch=>batch.deliveryId);
  async function start(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const result=await runtime.startErpCollection({workspaceId,ledgerId,requestId,retryFailed:true});
      if(!result?.ok){onRegistrationRetry?.();throw new Error(result?.error||'采集尚未启动，请重试。');}
      setState(result);onStarted?.();
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  return <div className="erp-workspace-launcher">
    <Button variant="primary" loading={busy} disabled={busy||!ready||running||Boolean(completed)} onClick={start}>{completed?'成本已采集':running?'正在采集成本':task?'继续成本核算':'开始成本核算'}</Button>
    {current?.status==='waiting_login'?<><span role="status">等待 ERP 登录，登录后自动继续本次采集。</span><Button onClick={()=>runtime.openErpLogin()}>登录 ERP</Button></>:null}
    {current?.status==='session_changed'?<span role="status">ERP 登录已变化，请重新准备本月采集。</span>:null}
    {error?<span role="alert">{error}</span>:null}
  </div>;
}
