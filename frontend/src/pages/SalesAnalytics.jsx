import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Decimal from "decimal.js";
import { Panel, Button } from "../components/UI";
import { readLedgerSalesAnalytics } from "../data/repositories/salesAnalyticsRepository";

const show = (value, digits = 2) => value == null ? "待查" : new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_DOWN).toFixed();
export default function SalesAnalytics({ workspaceId, ledgerId, store = "all" }) {
  const [metric, setMetric] = useState("revenueExact");
  const scope = JSON.stringify([workspaceId, ledgerId, store]);
  const result = useLiveQuery(async () => {
    try { return { scope, data: await readLedgerSalesAnalytics({ workspaceId, ledgerId, store }) }; }
    catch (error) { return { scope, error: error.message }; }
  }, [workspaceId, ledgerId, store]);
  if (!result || result.scope !== scope) return <Panel>正在读取每日销售...</Panel>;
  if (result.error) return <Panel><p role="alert">{result.error}</p></Panel>;
  const { data } = result;
  const max = Math.max(1, ...data.daily.map((day) => Math.abs(Number(day[metric]))));
  return <Panel className="sales-analytics">
    <div className="sales-analytics-heading"><div><h2>每日销售</h2><p>{data.period} · {store === "all" ? "全部店铺" : store} · 按台账添加时间</p></div><div role="group" aria-label="趋势指标"><Button aria-pressed={metric === "revenueExact"} onClick={() => setMetric("revenueExact")}>销售额</Button><Button aria-pressed={metric === "quantityExact"} onClick={() => setMetric("quantityExact")}>销量</Button></div></div>
    <p>销售原额 ¥{show(data.monthTotalsExact.revenueExact)} · 销量 {show(data.monthTotalsExact.quantityExact, 6)} 件</p>
    {data.coverage.status !== "complete" ? <p role="status">{data.coverage.status === "unknown" ? "尚未取得销售数据，空白日期未视为零。" : `${data.undated.count} 条销售记录缺少有效月内添加日期（含 ${data.outOfPeriod.count} 条超月），金额 ¥${show(data.undated.revenueExact)}、销量 ${show(data.undated.quantityExact, 6)} 件未定位到日期。请核对添加时间映射和账本月份，再重新导入；空白日期待查。`}</p> : null}
    <div className="sales-daily-chart" aria-label={metric === "revenueExact" ? "每日销售额" : "每日销量"}>
      {data.daily.map((day) => <div className="sales-daily-bar" key={day.date} title={`${day.date}：${day[metric]}${metric === "revenueExact" ? " 元" : " 件"}`}><span className={Number(day[metric]) < 0 ? "is-negative" : ""} style={{ height: `${Math.max(0, Math.abs(Number(day[metric])) / max * 100)}px` }} /><small>{day.date.slice(8)}</small></div>)}
    </div>
    <details><summary>每日数值与单价、活动信息</summary><div className="sales-analytics-tables"><table><thead><tr><th>日期</th><th>销售原额</th><th>销量</th></tr></thead><tbody>{data.daily.map((day) => <tr key={day.date}><td>{day.date}</td><td>{show(day.revenueExact)}</td><td>{show(day.quantityExact, 6)}</td></tr>)}</tbody></table><table><thead><tr><th>店铺 / SKU / 属性</th><th>加权均价</th><th>最低–最高单价</th><th>活动信息</th></tr></thead><tbody>{data.skuStats.map((sku) => <tr key={`${sku.store}/${sku.platformSku}`}><td>{sku.store} / {sku.platformSku}<small>{sku.attributes.join("、")}</small></td><td>{show(sku.averagePriceExact, 6)}</td><td>{show(sku.minPriceExact, 6)} – {show(sku.maxPriceExact, 6)}<small>单价覆盖 {sku.priceRowCount}/{sku.count} 行</small></td><td>{sku.activities.join("、") || "待查"}<small>活动覆盖 {sku.knownActivityCount}/{sku.count} 行；缺失不代表未参加</small></td></tr>)}</tbody></table></div></details>
  </Panel>;
}
