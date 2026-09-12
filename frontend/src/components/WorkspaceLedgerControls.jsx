import { Link } from 'react-router-dom';
import { Panel } from './UI';
import { profitWorkspaceHref } from '../lib/workspaceNavigation';
const labels = { draft: '草稿', cost_pending: '待补正式成本', approval_pending: '待人工确认', ready: '可定稿', finalized: '已定稿', locked: '已锁定' };

export default function WorkspaceLedgerControls({ scope, onError }) {
  const context = scope.context;
  const ready = scope.ready && !context?.error;
  const ledger = ready ? context.selected : null;
  const change = (field, value) => { void scope.change(field, value).catch(error => onError(error.message)); };
  return <Panel className="workspace-ledger-controls">
    <div className="workspace-ledger-heading"><div><h2>月度账本管理</h2><p>选择核算月份与店铺，查看销售趋势并处理当月成本。</p></div><Link className="button button-secondary" to={`/ledger${context?.query ? `?${context.query}` : ''}`}>全部账本管理</Link></div>
    {!scope.ready ? <p role="status">正在读取当前工作区账本…</p> : context.error ? <p role="alert">账本读取失败：{context.error}</p> : !ledger ? <p>还没有月度账本，导入同月各店铺台账后开始核算。</p> : <>
      <div className="workspace-ledger-filters">
        <label>核算月份<select className="select-input" aria-label="首页核算月份" value={ledger.id} onChange={event => change('ledger', event.target.value)}>{context.ledgers.map(item => <option key={item.id} value={item.id}>{item.period}</option>)}</select></label>
        <label>店铺<select className="select-input" aria-label="首页店铺" value={context.store} onChange={event => change('store', event.target.value)}><option value="all">全部店铺</option>{context.stores.map(store => <option key={store} value={store}>{store}</option>)}</select></label>
        <div className="workspace-ledger-status"><strong>账本状态（整月）：{labels[ledger.status] || '待核对'}</strong><span>{ledger.costSummary?.missingCount == null ? '正式成本状态待核对' : `整月 ${ledger.costSummary.missingCount} 条 SKU 待补正式成本`}</span></div>
      </div>
    </>}
    <div className="workspace-ledger-actions">
      <Link className="button button-primary" to={`/import-preview${ready && context.query ? `?${context.query}` : ''}`}>同月多店批量导入</Link>
      {ledger ? <><Link className="button button-secondary" to={profitWorkspaceHref(context.query, 'cost')}>补齐成本</Link><Link className="button button-secondary" to={profitWorkspaceHref(context.query, 'detail')}>核算利润</Link></> : null}
    </div>
  </Panel>;
}
