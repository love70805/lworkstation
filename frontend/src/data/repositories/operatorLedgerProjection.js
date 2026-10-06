import { getLedgerSnapshot } from './profitRepository';
import { readCachedReportProducts } from './derivedComputationService';
import { filterOperatorRows } from '../../domain/operatorScope';
import { summarizeLedgerRows } from '../../domain/ledgerImport';
import { presentReportProducts } from '../../lib/profitPresentation';
import { isProfitSnapshot, savedProfitRows, summarizeProfitRows } from '../../lib/profitPrecision';

// Read-only projection. Full snapshots always reach the calculation engine.
export async function projectOperatorLedgers(ledgers, scope) {
  if (scope.mode === 'all') return ledgers;
  const result = [];
  for (const ledger of ledgers) {
    const snapshot = await getLedgerSnapshot(ledger.id);
    if (!snapshot || snapshot.ledger.workspaceId !== ledger.workspaceId) continue;
    if (isProfitSnapshot(snapshot.ledger) && (!snapshot.profitLines?.length || !snapshot.ledger.profitSummary)) throw new Error('历史定稿快照缺失，请恢复完整备份后查看负责范围。');
    const source = filterOperatorRows(snapshot.rows, scope);
    if (!source.length) continue;
    const calculated = isProfitSnapshot(ledger) ? savedProfitRows(snapshot.profitLines)
      : presentReportProducts(await readCachedReportProducts({ snapshot, warehouseRate: ledger.warehouseRate ?? 0.7 }), snapshot);
    const visible = filterOperatorRows(calculated, scope, snapshot.rows);
    const summary = summarizeProfitRows(visible);
    result.push({ ...ledger, summary: summarizeLedgerRows(source),
      costSummary: { expectedCount: visible.length, formalMatchedCount: visible.filter(row => row.finalizable).length },
      currentResult: { state: 'operator_scope', profit: summary.missing ? null : summary.matchedProfit, label: isProfitSnapshot(ledger) ? '我的商品 · 定稿快照' : '我的商品 · 当前正式成本' },
    });
  }
  return result;
}
