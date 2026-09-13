// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SalesAnalytics from './SalesAnalytics';
import { aggregateDailySales, aggregateDailySalesDetails } from '../domain/salesAnalytics';
const mocks=vi.hoisted(()=>({month:vi.fn(),day:vi.fn()}));
vi.mock('../data/repositories/salesAnalyticsRepository',()=>({readLedgerSalesAnalytics:mocks.month,readLedgerDailySalesDetails:mocks.day}));
let container,root;
const period='2026-08',date='2026-08-01';
const rows=Array.from({length:15},(_,i)=>({store:'甲',platformSku:`SKU-${String(i).padStart(2,'0')}`,platformSkc:`skc-${String(i).padStart(2,'0')}`,quantity:i+1,amount:15-i,sourceAddedDate:date,attribute:'红色',activityStatus:'known',activityRaw:'客单创建时间:2026-08-01 04:58:49, 参与活动:【shein全球大促】2026年「返校季」常规活动, 活动时间范围:2026-07-27 00:00:00~2026-08-10 23:59:59, 结算价格:13.25'}));
rows.push({store:'甲',platformSku:'OTHER-DAY',quantity:-0.5,amount:-0.009,sourceAddedDate:'2026-08-02'});
const props={workspaceId:'W',ledgerId:'L',stores:['甲','乙']};
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
const dayButton=()=>container.querySelector('.sales-daily-bar');
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}
async function render(extra={}){await act(async()=>root.render(<SalesAnalytics {...props} {...extra}/>));await settle();}
async function click(node){await act(async()=>node.click());await settle();}
beforeEach(async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();
 mocks.month.mockImplementation(async()=>aggregateDailySales(rows,{period}));
 mocks.day.mockImplementation(async scope=>aggregateDailySalesDetails(rows,{period,date:scope.date}));
 container=document.createElement('div');document.body.append(container);root=createRoot(container);await render();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('hover/focus reads both exact values without database work; toggling/reopening does not recalculate month',async()=>{
 expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
 await act(async()=>Simulate.mouseEnter(container.querySelectorAll('.sales-daily-bar')[1]));
 expect(container.querySelector('.sales-hover-summary').textContent).toContain('¥-0.009 · 销量 -0.5 件');
 expect(mocks.day).not.toHaveBeenCalled();
 const negative=container.querySelector('.is-negative');expect(negative.style.top).toBe(container.querySelector('.sales-zero-line').style.top);
 await click(dayButton());expect(container.querySelector('.sales-day-details').textContent).not.toContain('OTHER-DAY');
 await click(button('销量'));expect(mocks.day).toHaveBeenCalledTimes(1);expect(mocks.month).toHaveBeenCalledTimes(1);
 await click(button('返回全月'));await click(dayButton());expect(mocks.month).toHaveBeenCalledTimes(1);
 await act(async()=>Simulate.keyDown(container.querySelector('.sales-day-details'),{key:'Escape'}));expect(container.querySelector('.sales-day-details')).toBeNull();
});
it('paginates only selected-day products, searches without changing totals and shows SKC and concise activity names',async()=>{
 await click(dayButton());expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
 expect(container.querySelector('tbody tr').textContent).toContain('skc-00');
 expect(container.querySelector('.sales-activities').open).toBe(false);expect(container.querySelector('.sales-activity-original')).toBeNull();
 const activity=container.querySelector('.sales-activities');
 await act(async()=>{activity.open=true;activity.dispatchEvent(new Event('toggle'));});
 expect(activity.textContent).toContain('「返校季」常规活动');
 expect(activity.textContent).not.toMatch(/客单创建时间|活动时间范围|结算价格|04:58:49/);
 expect(container.querySelector('tbody tr strong').textContent).toBe('skc-00');
 await click(button('下一页'));expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
 const sort=container.querySelector('.sales-details-controls select');await act(async()=>Simulate.change(sort,{target:{value:'quantityExact'}}));
 expect(container.querySelector('tbody tr').textContent).toContain('skc-14');
 const before=container.querySelector('.sales-details-heading p').textContent;
 await act(async()=>Simulate.change(container.querySelector('.sales-details-controls input'),{target:{value:'SKC-03'}}));
 expect(container.querySelectorAll('tbody tr')).toHaveLength(1);expect(container.querySelector('.sales-details-heading p').textContent).toBe(before);
 expect(container.querySelector('.sales-list-scope').textContent).toContain('1/15');
});
it.each([{store:'乙'},{ledgerId:'new-month'},{workspaceId:'other-workspace'}])('discards a late day response after scope changes %j',async next=>{
 let finish;mocks.day.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await click(dayButton());expect(container.textContent).toContain('正在读取 2026-08-01');
 await render(next);expect(container.querySelector('.sales-day-details')).toBeNull();
 await act(async()=>finish(aggregateDailySalesDetails(rows,{period,date})));await settle();
 expect(container.querySelector('.sales-day-details')).toBeNull();expect(container.querySelector('[aria-pressed=true].sales-daily-bar')).toBeNull();
});
it('keeps store parent-controlled, displays async wait/failure and clears selection on change request',async()=>{
 let fail;const change=vi.fn(()=>new Promise((_,reject)=>{fail=reject;}));await render({onStoreChange:change});await click(dayButton());
 const select=container.querySelector('[aria-label="每日销售店铺"]');await act(async()=>Simulate.change(select,{target:{value:'乙'}}));
 expect(change).toHaveBeenCalledWith('乙');expect(select.value).toBe('all');expect(select.disabled).toBe(true);expect(container.querySelector('.sales-day-details')).toBeNull();
 await act(async()=>fail(new Error('切换失败')));expect(container.textContent).toContain('切换失败');expect(select.disabled).toBe(false);
 await render({store:'乙',onStoreChange:()=>{}});expect(container.textContent).not.toContain('切换失败');
});
it('distinguishes a known zero day from an unlocated unknown day',async()=>{
 await click(container.querySelectorAll('.sales-daily-bar')[2]);expect(container.textContent).toContain('当天已知销售额与销量为 0');
 await click(button('返回全月'));mocks.day.mockResolvedValueOnce(aggregateDailySalesDetails([],{period,date}));
 await click(dayButton());expect(container.querySelector('.sales-day-details').textContent).toContain('销售原额 待查 · 销量 待查');
});
