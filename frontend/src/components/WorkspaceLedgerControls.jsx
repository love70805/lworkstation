import { Link } from 'react-router-dom';
import { Button, Panel } from './UI';
import { profitWorkspaceHref } from '../lib/workspaceNavigation';
import { ledgerNextStep } from '../domain/ledgerWorkflow';
const labels = { draft: '草稿', cost_pending: '待核对成本', approval_pending: '待确认成本', ready: '待确认利润', finalized: '已定稿', locked: '已锁定' };

export default function WorkspaceLedgerControls({ scope, onError }) {
  const context = scope.context;
  const ready = scope.ready && !context?.error;
  const ledger = ready ? context.selected : null;
  const change = (field, value) => { void scope.change(field, value).catch(error => onError(error.message)); };
  return <Panel className="workspace-ledger-controls">
    <div className="workspace-ledger-heading"><h2>月度账本</h2><Link className="button button-secondary" to={`/ledger${context?.query ? `?${context.query}` : ''}`}>管理账本</Link></div>
    {!scope.ready ? <p role="status">正在读取当前工作区账本…</p> : context.error ? <div><p role="alert">账本读取失败：{context.error}</p><Link to="/ledger" className="button button-secondary">选择账本</Link><Button onClick={scope.retry}>重试</Button></div> : !ledger ? <p>还没有月度账本，导入同月各店铺台账后开始核算。</p> : <>
      <div className="workspace-ledger-filters">
        <label>核算月份<select className="select-input" aria-label="首页核算月份" value={ledger.id} onChange={event => change('ledger', event.target.value)}>{context.ledgers.map(item => <option key={item.id} value={item.id}>{item.period}</option>)}</select></label>
        <label>店铺<select className="select-input" aria-label="首页店铺" value={context.store} onChange={event => change('store', event.target.value)}><option value="all">全部店铺</option>{context.stores.map(store => <option key={store} value={store}>{store}</option>)}</select></label>
        <div className="workspace-ledger-status"><strong>账本状态（整月）：{labels[ledger.status] || '待核对'}</strong><span>{ledgerNextStep(ledger).text}</span></div>
      </div>
    </>}
    {ready ? <div className="workspace-ledger-actions">
      {!['finalized', 'locked'].includes(ledger?.status) ? <Link className="button button-primary" state={{ importReturnTo: `/workspace${context.query ? `?${context.query}` : ''}` }} to={`/import-preview${context.query ? `?${context.query}` : ''}`}>同月多店批量导入</Link> : null}
      {ledger ? <><Link className="button button-secondary" to={profitWorkspaceHref(context.query, 'cost')}>{['finalized', 'locked'].includes(ledger.status) ? '查看成本' : '核对成本'}</Link><Link className="button button-secondary" to={profitWorkspaceHref(context.query, 'detail')}>{['finalized', 'locked'].includes(ledger.status) ? '查看本月报告' : '核算利润'}</Link></> : null}
    </div> : null}
  </Panel>;
}
