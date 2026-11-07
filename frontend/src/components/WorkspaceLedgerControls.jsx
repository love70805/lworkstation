import { Link } from 'react-router-dom';
import { Badge, Button, Panel } from './UI';
import { CalendarDays } from 'lucide-react';
import PendingSkuStatus from './PendingSkuStatus';
import BoardSelect from './BoardSelect';
const labels = { draft: '草稿', cost_pending: '待核对成本', approval_pending: '待确认成本', ready: '成本已齐', finalized: '可继续调整', locked: '可继续调整' };

export default function WorkspaceLedgerControls({ scope, onError, refresh = 0, children }) {
  const context = scope.context;
  const ready = scope.ready && !context?.error;
  const ledger = ready ? context.selected : null;
  const change = (field, value) => { void scope.change(field, value).catch(error => onError(error.message)); };
  return <Panel className="workspace-ledger-controls">
    <section className="workspace-scope" aria-labelledby="workspace-scope-title">
    <div className="workspace-ledger-heading"><h2 id="workspace-scope-title"><CalendarDays size={18} />当前核算范围</h2><Link className="workspace-manage-link" to={`/ledger${context?.query ? `?${context.query}` : ''}`}>管理账本</Link></div>
    {!scope.ready ? <p role="status">正在读取当前工作区账本…</p> : context.error ? <div><p role="alert">账本读取失败：{context.error}</p><Link to="/ledger" className="button button-secondary">选择账本</Link><Button onClick={scope.retry}>重试</Button></div> : !ledger ? <p>还没有月度账本，导入同月各店铺台账后开始核算。</p> : <>
      <div className="workspace-ledger-filters">
        <BoardSelect className="active-period" label="核算月份" ariaLabel="首页核算月份" value={ledger.id} onChange={id => change('ledger', id)}
          options={context.ledgers.map(item => ({ id: item.id, label: item.period.replace('-', ' 年 ') + ' 月' }))} />
        <BoardSelect label="店铺" ariaLabel="首页店铺" value={context.store} onChange={store => change('store', store)}
          options={[{ id: 'all', label: '全部店铺' }, ...context.stores.map(store => ({ id: store, label: store }))]} />
      </div>
      <div className="workspace-scope-status">
        <div className="workspace-ledger-status"><span>整月账本状态</span><Badge tone={['finalized', 'locked'].includes(ledger.status) ? 'success' : 'info'}>{labels[ledger.status] || '待核对'}</Badge></div>
        <PendingSkuStatus key={JSON.stringify([context.workspaceId, ledger.id, context.store, refresh])}
          workspaceId={context.workspaceId} ledgerId={ledger.id} store={context.store} />
      </div>
    </>}
    </section>
    {children}
  </Panel>;
}
