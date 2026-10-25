import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profitWorkspaceHref, validatedLedgerSearch, workspaceLedgerQuery } from "./workspaceNavigation";
import { buildProfitQuery, filterProfitRowsByScope, readProfitFilter } from './profitFilter';
import { importReturnHref } from './importNavigation';
describe("首页与账本侧栏上下文", () => {
  const ledger = { id: "L1", workspaceId: "W1" };
  it("只携带当前工作区已验证账本和筛选", () => {
    expect(validatedLedgerSearch("?ledger=L1&q=中文&store=甲&supplier=A&supplier=B&missing=1&foreign=value", ledger, "W1"))
      .toBe("?ledger=L1&q=%E4%B8%AD%E6%96%87&store=%E7%94%B2&supplier=A&supplier=B&missing=1");
  });
  it("不携带不存在、跨工作区或已切换账本上下文", () => {
    expect(validatedLedgerSearch("?ledger=L1&q=秘密", ledger, "W2")).toBe("");
    expect(validatedLedgerSearch("?ledger=L1", null, "W1")).toBe("");
    expect(validatedLedgerSearch("?ledger=L2", ledger, "W1")).toBe("");
    expect(validatedLedgerSearch("?q=秘密", ledger, "W1")).toBe("");
  });
  it('only preserves supported profit views and forces cost compatibility destination', () => {
    expect(validatedLedgerSearch('?ledger=L1&view=cost', ledger, 'W1')).toBe('?ledger=L1&view=cost');
    expect(validatedLedgerSearch('?ledger=L1&view=unknown', ledger, 'W1')).toBe('?ledger=L1');
    const query = workspaceLedgerQuery('L1', '?view=detail&store=甲', [{store:'甲'}], true);
    expect(query.get('view')).toBe('detail');
    expect(profitWorkspaceHref(query, 'cost')).toContain('view=cost');
    expect(profitWorkspaceHref('', 'unknown')).toBe('/profit?view=detail');
  });
  it("切换月份只保留新账本存在的店铺和货号，显式重置缺省值", () => {
    const rows = [{ store: "甲店", supplierNumber: "A" }];
    const query = workspaceLedgerQuery("L2", "?store=甲店&q=关键词&supplier=A&supplier=B&missing=1", rows, true);
    expect(query.get("store")).toBe("甲店");
    expect(query.getAll("supplier")).toEqual(["A"]);
    expect(query.get("q")).toBe("关键词");
    expect(query.get("missing")).toBe("1");
    expect(workspaceLedgerQuery("L2", "?store=乙店", rows, true).get("store")).toBe("all");
    expect(workspaceLedgerQuery("L2", "?supplier=", rows, true).getAll("supplier")).toEqual([""]);
    expect(workspaceLedgerQuery("L2", query.toString(), rows, false).toString()).toBe("ledger=L2&store=all&missing=0");
  });
});

describe('supplier scope across workspace navigation', () => {
  const ledger = { id: 'L1', workspaceId: 'W1' };
  const rows = [{ store: '甲店', supplierNumber: 'DEMO-X' }, { store: '乙店', supplierNumber: 'DEMO-X' }, { store: '乙店', supplierNumber: 'OTHER' }];
  const scopedQuery = () => buildProfitQuery({ ledgerId: 'L1', workspaceId: 'W1', supplierSelection: ['DEMO-X'], supplierStoreSelection: [rows[1]] });
  const read = (params, ledgerId = 'L1', workspaceId = 'W1') => readProfitFilter(new URLSearchParams(params), ledgerId, { workspaceId });
  beforeEach(() => {
    const data = new Map();
    vi.stubGlobal('sessionStorage', { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves per-store exclusions through the sidebar, home normalization and import return', () => {
    const query = scopedQuery(), reference = query.get('supplier_scope');
    const sidebar = validatedLedgerSearch(query, ledger, 'W1');
    const home = workspaceLedgerQuery('L1', sidebar, rows, true, { workspaceId: 'W1' });
    const back = new URL(importReturnHref(home, `/profit?${home}`, 'L1', { workspaceId: 'W1' }), 'https://example.invalid').searchParams;
    for (const params of [new URLSearchParams(sidebar), home, back]) {
      expect(params.get('supplier_scope')).toBe(reference);
      expect(filterProfitRowsByScope(rows, read(params))).toEqual([rows[1]]);
    }
  });

  it('preserves more than 80 suppliers without expanding the URL or selection', () => {
    const supplierSelection = Array.from({ length: 100 }, (_, index) => `DEMO-${index}`);
    const query = buildProfitQuery({ ledgerId: 'L1', workspaceId: 'W1', supplierSelection });
    const sidebar = validatedLedgerSearch(query, ledger, 'W1');
    const home = workspaceLedgerQuery('L1', sidebar, [], true, { workspaceId: 'W1' });
    const back = new URL(importReturnHref(home, null, 'L1', { workspaceId: 'W1' }), 'https://example.invalid').searchParams;
    for (const params of [new URLSearchParams(sidebar), home, back]) {
      expect(params.toString().length).toBeLessThan(200);
      expect(read(params).supplierSelection).toEqual([...supplierSelection].sort());
    }
    const nextRows = supplierSelection.slice(0, 81).map(supplierNumber => ({ store: '甲店', supplierNumber }));
    const next = workspaceLedgerQuery('L2', query, nextRows, true, { workspaceId: 'W1' });
    expect(next.toString().length).toBeLessThan(200);
    expect(read(next, 'L2').supplierSelection).toEqual(supplierSelection.slice(0, 81).sort());
    expect(next.get('supplier_scope')).not.toBe(query.get('supplier_scope'));
  });

  it('rebinds a month change to the new ledger without adding another store or supplier', () => {
    const query = scopedQuery();
    const next = workspaceLedgerQuery('L2', query, rows, true, { workspaceId: 'W1' });
    expect(next.get('supplier_scope')).not.toBe(query.get('supplier_scope'));
    expect(filterProfitRowsByScope(rows, read(next, 'L2'))).toEqual([rows[1]]);
    expect(read(next, 'L1')).toMatchObject({ supplierSelection: [], supplierScopeError: expect.any(String) });
    const absent = workspaceLedgerQuery('L2', query, [rows[0], rows[2]], true, { workspaceId: 'W1' });
    expect(filterProfitRowsByScope(rows, read(absent, 'L2'))).toEqual([]);
    const shortAbsent = workspaceLedgerQuery('L2', '?ledger=L1&supplier=MISSING', rows, true, { workspaceId: 'W1' });
    expect(read(shortAbsent, 'L2').supplierSelection).toEqual([]);
  });

  it('keeps empty selections empty on same-ledger and cross-ledger navigation', () => {
    for (const filter of [{ supplierSelection: [] }, { supplierSelection: null, supplierStoreSelection: [] }]) {
      const query = buildProfitQuery({ ledgerId: 'L1', workspaceId: 'W1', ...filter });
      const sidebar = validatedLedgerSearch(query, ledger, 'W1');
      const next = workspaceLedgerQuery('L2', query, rows, true, { workspaceId: 'W1' });
      expect(filterProfitRowsByScope(rows, read(sidebar))).toEqual([]);
      expect(filterProfitRowsByScope(rows, read(next, 'L2'))).toEqual([]);
    }
  });

  it.each(['missing', 'malformed', 'foreign_workspace', 'foreign_ledger'])('keeps %s references closed with a visible error', kind => {
    const query = scopedQuery();
    if (kind === 'missing') sessionStorage.removeItem(`shopeers:profit-filter:scope:${query.get('supplier_scope')}`);
    if (kind === 'malformed') sessionStorage.setItem(`shopeers:profit-filter:scope:${query.get('supplier_scope')}`, '{');
    if (kind === 'foreign_workspace') query.set('supplier_scope', buildProfitQuery({ ledgerId: 'L1', workspaceId: 'OTHER', supplierSelection: ['DEMO-X'], supplierStoreSelection: [rows[1]] }).get('supplier_scope'));
    if (kind === 'foreign_ledger') query.set('ledger', 'L2');
    const current = query.get('ledger');
    const sidebar = validatedLedgerSearch(query, { ...ledger, id: current }, 'W1');
    const next = workspaceLedgerQuery('L3', query, rows, true, { workspaceId: 'W1' });
    const back = new URL(importReturnHref(query, null, current, { workspaceId: 'W1' }), 'https://example.invalid').searchParams;
    for (const [params, id] of [[sidebar, current], [next, 'L3'], [back, current]]) {
      const filter = read(params, id);
      expect(filter).toMatchObject({ supplierSelection: [], supplierScopeError: expect.any(String) });
      expect(filterProfitRowsByScope(rows, filter)).toEqual([]);
    }
  });

  it('does not reuse an import return reference for another ledger or unverified workspace', () => {
    const query = scopedQuery();
    for (const [id, options] of [['L2', { workspaceId: 'W1' }], ['L1', {}]]) {
      const back = new URL(importReturnHref(query, null, id, options), 'https://example.invalid').searchParams;
      expect(read(back, id)).toMatchObject({ supplierSelection: [], supplierScopeError: expect.any(String) });
    }
  });

  it.each([null, ''])('defaults a ledger without reopening a supplier scope whose source ledger is %s', sourceLedger => {
    const query = scopedQuery();
    if (sourceLedger === null) query.delete('ledger');
    else query.set('ledger', sourceLedger);
    const next = workspaceLedgerQuery('L1', query, rows, false, { workspaceId: 'W1' });
    expect(next.get('ledger')).toBe('L1');
    expect(next.get('supplier_scope')).toBe('unavailable');
    expect(read(next)).toMatchObject({ supplierSelection: [], supplierScopeError: expect.any(String) });
    expect(filterProfitRowsByScope(rows, read(next))).toEqual([]);
  });
});
