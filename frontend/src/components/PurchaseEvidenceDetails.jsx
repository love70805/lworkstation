import { useState } from 'react';
import { Info } from 'lucide-react';
import { calculateWarehouseCostDecision, ERP_COST_ANOMALY_LABELS, ERP_HISTORY_MIN_SAMPLES } from '../domain/erpCostResolution';
import { adoptedCostEvidence, purchaseEvidenceUnitPrice } from '../domain/erpPurchaseEvidence';
import { describeEvidenceIssues, evidenceRepairGuidance } from '../lib/costMatching';
import { formatManualUnitCost } from '../lib/profitPrecision';

const priceFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
function price(value) {
  if (value == null || !Number.isFinite(Number(value))) return '未提供';
  if (value > 0 && value < 0.000001) return formatManualUnitCost(value);
  return `¥${priceFormat.format(value)}`;
}

const exclusionLabels = {
  cancelled_or_closed: '订单已取消、关闭或作废',
  invalid_purchase_detail: '采购明细缺少有效的仓库 SKU、日期、数量或金额',
  after_ledger_period: '采购日期晚于本次核算月',
  on_or_after_ledger_period: '原回执按旧规则排除了核算月及以后的采购',
  current_month: '原回执按旧规则排除了采集当月的采购',
};
const statusLabels = {
  purchaseStatus: '采购状态', purchaseOrderStatus: '采购单状态', paymentStatus: '付款状态', payStatus: '付款状态',
  orderStatus: '订单状态', order1688Status: '1688 订单', orderStatus1688: '1688 订单', purchaseOrderStatus1688: '1688 订单', status: 'ERP 状态',
};

function OrderNumbers({ record }) {
  const order = record.purchaseOrderNo || record.purchaseOrderId;
  return <div className="purchase-order-numbers">
    {order && <span>采购单 {order}</span>}
    {record.order1688 && <span>1688 单号 {record.order1688}</span>}
    {!order && !record.order1688 && <span>回执未提供单号{record.recordId ? ` · 记录 ${record.recordId}` : ''}</span>}
  </div>;
}

function ExcludedPurchases({ records, title }) {
  const [open, setOpen] = useState(false);
  if (!records.length) return null;
  return <details className="cost-evidence-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}（{records.length} 笔）</summary>
    {open && <ul className="purchase-review-list">{records.map((record, index) => {
      const reasons = (record.exclusionReasons ?? []).map(reason => exclusionLabels[reason] ?? `来源注明的排除原因：${reason}`);
      const statuses = Object.entries(record.statusFields ?? {}).filter(([key, value]) => statusLabels[key] && value != null && value !== '')
        .map(([key, value]) => `${statusLabels[key]} ${statusLabels[key] === '1688 订单' && String(value) === '4' ? '已取消（4）' : value}`);
      const unitPrice = purchaseEvidenceUnitPrice(record);
      return <li key={record.recordId ?? index}>
        <div className="purchase-review-line"><strong>{record.purchaseDate || '未提供日期'}</strong>
          {unitPrice != null && <span>{price(unitPrice)}/件</span>}</div>
        <OrderNumbers record={record} />
        <span>{reasons.join('。') || '该回执未注明排除原因'}</span>
        {statuses.length > 0 && <small>{[...new Set(statuses)].join(' · ')}</small>}
      </li>;
    })}</ul>}
  </details>;
}

function evidenceReason(reason, baseline) {
  if (reason === 'recent_price_shift_low' && baseline?.lowerBound != null) return `低于历史下限 ${price(baseline.lowerBound)}，最近采购中至少两笔偏低`;
  if (reason === 'recent_price_shift_high' && baseline?.upperBound != null) return `高于历史上限 ${price(baseline.upperBound)}，最近采购中至少两笔偏高`;
  return ERP_COST_ANOMALY_LABELS[reason] ?? reason;
}

function PurchaseLine({ record, anomaly, reviewed }) {
  const state = anomaly?.status;
  const status = state === 'ignored' ? '已按原价忽略' : state === 'resolved'
    ? anomaly.resolution?.action === 'correct_price' ? '采购价已修正' : '采购价已确认'
    : anomaly ? '价格异常待核对' : reviewed ? '未触发异常' : '';
  return <li>
    <div className="purchase-review-line"><strong>{price(record.unitPrice ?? purchaseEvidenceUnitPrice(record))}/件</strong>
      {status && <span className={anomaly ? 'purchase-review-status' : undefined}>{status}</span>}</div>
    {anomaly?.description && <span className="purchase-review-reason">{anomaly.description}</span>}
    {record.resolution?.action === 'correct_price' && <span>更正后 {price(record.effectiveUnitPrice)}/件</span>}
    <small>{record.purchaseDate || '未提供日期'}{record.totalPrice != null && record.quantity > 0
      ? ` · 总价 ${formatManualUnitCost(record.totalPrice)} ÷ ${record.quantity} 件` : ''}</small>
    <OrderNumbers record={record} />
  </li>;
}

export default function PurchaseEvidenceDetails({ match, period }) {
  const raw = adoptedCostEvidence(match.raw ?? match);
  const actual = match.costDecision ?? raw.decision;
  const lowest = actual?.resolutionVersion === 'inventory-lowest@2';
  const review = lowest ? match.purchaseReview : match;
  const warehouseSku = match.sourceWarehouseSku || match.warehouseSku || raw.evidence?.warehouseSku;
  let decision = lowest ? review?.costDecision : actual;
  // Older adopted rows may contain the complete purchases without a stored baseline.
  if (!lowest && !decision?.baseline && !match.baseline && raw.evidence?.evidenceComplete && warehouseSku && raw.records.length && !match.periodReviewRequired) {
    decision = calculateWarehouseCostDecision({ warehouseSku, period, purchaseRecords: raw.records, evidenceComplete: true,
      resolutions: actual?.resolutions ?? raw.evidence.resolutions });
  }
  const baseline = decision?.baseline ?? review?.baseline;
  const anomalies = decision?.anomalies ?? review?.anomalies ?? [];
  const records = decision?.selectedRecords ?? (lowest ? [] : raw.selected.filter(Boolean));
  const originalExclusions = review?.excludedRecords ?? raw.evidence?.excludedRecords ?? [];
  const excludedIds = new Set(originalExclusions.map(record => record.recordId).filter(Boolean));
  const periodExclusions = (decision?.purchaseRecords ?? []).filter(record =>
    (record.eligible === false || record.exclusionReasons?.length) && !excludedIds.has(record.recordId));
  const issues = lowest ? [] : describeEvidenceIssues(match).filter(issue => issue.key !== 'excludedRecords');
  const guidance = evidenceRepairGuidance(issues.map(issue => issue.key));
  return <section className="purchase-review" aria-label="采购价格与排除记录">
    {warehouseSku && <p>仓库 SKU {warehouseSku}</p>}
    <h4>历史价格区间</h4>
    {baseline?.enabled ? <>
      <strong className="purchase-review-range">{price(baseline.lowerBound)} ～ {price(baseline.upperBound)}/件</strong>
      <small>截至 {decision?.costPeriod ?? period} · {baseline.sampleCount} 笔合格正单价 · 中位数 {price(baseline.median)}/件</small>
    </> : <p>{baseline ? `截至 ${decision?.costPeriod ?? period}，共 ${baseline.sampleCount} 笔合格正单价，满 ${ERP_HISTORY_MIN_SAMPLES} 笔可计算区间。` : '当前证据未提供历史价格区间。'}</p>}
    {decision?.evidenceComplete === false && <small>采购历史尚未完整回传，以上仅含已取得的记录。</small>}
    {records.length ? <><h4>{match.periodReviewRequired ? '原采用的采购' : '最近的合格采购'}（{records.length} 笔）</h4>
      <ul className="purchase-review-list">{records.map(record => {
        const anomaly = anomalies.find(item => item.recordId === record.recordId);
        return <PurchaseLine key={record.recordId} record={record} reviewed={Boolean(baseline)}
          anomaly={anomaly && { ...anomaly, description: (anomaly.reasons ?? []).map(reason => evidenceReason(reason, baseline)).join('。') }} />;
      })}</ul></> : <p>{decision ? '本期没有合格采购。' : '当前证据未提供最近采购明细。'}</p>}
    {lowest && <><h4>最低成本模式取价凭证</h4><ul className="purchase-review-list">
      {actual.selectedRecords.map(record => <PurchaseLine key={record.recordId} record={record} />)}
    </ul></>}
    <ExcludedPurchases title="ERP 采集时排除的订单" records={originalExclusions} />
    <ExcludedPurchases title="本期核算排除的订单" records={periodExclusions} />
    {issues.length > 0 && <details className="cost-evidence-details"><summary><Info size={14} />查看证据问题与补齐指引</summary>
      <div className="cost-evidence-details-body"><ul className="cost-evidence-issue-list">
        {issues.map(issue => <li key={issue.key}><strong>{issue.label}</strong><span>{issue.detail}</span></li>)}
      </ul>{guidance.length > 0 && <div className="cost-evidence-guidance"><strong>建议</strong>{guidance.map(item => <p key={item}>{item}</p>)}</div>}</div>
    </details>}
  </section>;
}
