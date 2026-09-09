import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, Inbox } from "lucide-react";
import AppShell from "../components/AppShell";
import { EmptyState, Panel, useToast } from "../components/UI";
import { db, getActiveMemberContext, listLedgerSummaries } from "../data/database";
import { workspaceLedgerQuery } from "../lib/workspaceNavigation";
import { ProfitWorkspaceContent } from "./ProfitPanel";

export default function WorkspacePortal() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useToast();
  const [switching, setSwitching] = useState(false);
  const generation = useRef(0);
  const ledgerId = searchParams.get("ledger");
  const context = useLiveQuery(async () => {
    const member = await getActiveMemberContext();
    const ledgers = (await listLedgerSummaries()).filter(ledger => ledger.workspaceId === member.workspaceId);
    return { workspaceId: member.workspaceId, ledgers, ledgerId };
  }, [ledgerId], null);
  const ready = context?.ledgerId === ledgerId;
  const selected = ready ? context.ledgers.find(ledger => ledger.id === ledgerId) : null;
  useEffect(() => {
    if (!ready || selected) return;
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
      const rows = await db.salesRows.where("ledgerId").equals(id).toArray();
      const member = await getActiveMemberContext();
      if (token !== generation.current || member.workspaceId !== context.workspaceId) return;
      setSearchParams(workspaceLedgerQuery(id, location.search, rows, Boolean(selected)));
    } catch (error) { notify(`切换月份失败：${error.message}`, "error"); }
    finally { if (token === generation.current) setSwitching(false); }
  }
  return (
    <AppShell pageClass="workspace-page profit-page">
      <section className="workspace-entry-bar" aria-label="经营入口">
        <div><strong>工作区首页</strong><span>按账本核对成本，完成月度利润核算</span></div>
        {ready && context.ledgers.length > 0 ? <label className="workspace-month-picker"><span>核算月份</span>
          <select className="select-input" aria-label="核算月份" value={selected?.id || ""} disabled={switching || !selected} onChange={event => { void selectLedger(event.target.value); }}>
            {!selected ? <option value="">正在选择账本…</option> : null}
            {context.ledgers.map(ledger => <option key={ledger.id} value={ledger.id}>{ledger.period}</option>)}
          </select>
        </label> : null}
        <nav aria-label="选品入口">
          <Link to="/products"><Archive size={16} />选品工作台</Link>
          <Link to="/products?view=pending"><Inbox size={16} />待确认采集</Link>
        </nav>
      </section>
      {!ready || (context.ledgers.length > 0 && !selected) ? <div role="status">正在读取当前工作区账本…</div>
        : selected ? <div className="workspace-profit-content"><ProfitWorkspaceContent key={selected.id} /></div>
          : <Panel><EmptyState title="还没有月度账本" description="先导入销售台账，再核对成本和利润。" action={<Link to="/import-preview" className="button primary">导入月度台账</Link>} /></Panel>}
    </AppShell>
  );
}
