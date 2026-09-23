import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import AppShell from "../components/AppShell";
import { Button, EmptyState, Panel, useToast } from "../components/UI";
import { getActiveMemberContext, listLedgerSummaries } from "../data/database";
import { workspaceLedgerQuery } from "../lib/workspaceNavigation";
import { ProfitViewsContent } from "./ProfitPanel";
import { readProfitView } from "../lib/profitFilter";
import { readLedgerSalesRows } from "../data/repositories/ledgerReadCache";

export default function ProfitWorkspacePage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useToast();
  const [switching, setSwitching] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const ledgerId = searchParams.get("ledger");
  const context = useLiveQuery(async () => {
    try {
    const member = await getActiveMemberContext();
    const ledgers = (await listLedgerSummaries()).filter(ledger => ledger.workspaceId === member.workspaceId);
    if ((await getActiveMemberContext()).workspaceId !== member.workspaceId) throw new Error('工作区已切换，请重新读取。');
    return { workspaceId: member.workspaceId, ledgers, ledgerId };
    } catch (error) { return { ledgerId, ledgers: [], error: error.message }; }
  }, [ledgerId, retry], null);
  const ready = context?.ledgerId === ledgerId;
  const selected = ready ? context.ledgers.find(ledger => ledger.id === ledgerId) : null;
  useEffect(() => {
    if (!ready || context.error || selected || ledgerId) return;
    if (context.ledgers.length) setSearchParams(workspaceLedgerQuery(context.ledgers[0].id), { replace: true });
    else if (location.search) setSearchParams({}, { replace: true });
  }, [ready, selected, context, location.search, setSearchParams]);
  useEffect(() => () => { generation.current += 1; }, []);
  async function selectLedger(id) {
    const target = context.ledgers.find(ledger => ledger.id === id);
    if (!target) return;
    const token = ++generation.current;
    setSwitching(true);
    try {
      const rows = await readLedgerSalesRows(context.workspaceId, id, { strict: true });
      const member = await getActiveMemberContext();
      if (token !== generation.current || member.workspaceId !== context.workspaceId) return;
      const next = workspaceLedgerQuery(id, location.search, rows, Boolean(selected));
      next.set("view", readProfitView(new URLSearchParams(location.search)) ?? "detail");
      setSearchParams(next);
    } catch (error) { notify(`切换月份失败：${error.message}`, "error"); }
    finally { if (token === generation.current) setSwitching(false); }
  }
  return (
    <AppShell pageClass="workspace-page profit-page">
      {context?.error ? <Panel><p role="alert">账本读取失败：{context.error}</p><Button onClick={() => setRetry(value => value + 1)}>重新读取账本</Button></Panel> : ready && ledgerId && !selected ? <Panel><p role="alert">账本不属于当前工作区或已不存在。</p><Link to="/ledger">重新选择账本</Link></Panel> : !ready || (context.ledgers.length > 0 && !selected) ? <div role="status">正在读取当前工作区账本…</div>
        : selected ? <div className="workspace-profit-content"><ProfitViewsContent key={`${context.workspaceId}/${selected.id}`} monthControl={<label className="workspace-month-picker"><span>核算月份</span><select className="select-input" aria-label="核算月份" value={selected.id} disabled={switching} onChange={event => { void selectLedger(event.target.value); }}>{context.ledgers.map(ledger => <option key={ledger.id} value={ledger.id}>{ledger.period}</option>)}</select></label>} /></div>
          : <Panel><h1>利润核算</h1><EmptyState title="还没有月度账本" description="先导入销售台账，再核对成本和利润。" action={<Link to="/import-preview" className="button primary">导入月度台账</Link>} /></Panel>}
    </AppShell>
  );
}
