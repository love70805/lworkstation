import Decimal from 'decimal.js';
import { createLedgerGroupKey, createLedgerSkuKey } from './ledgerImport';
import { groupReportSales } from './profitReports';
import { groupImportedSales } from '../lib/profit';

// Page-only inputs. Reports, exports and evidence keep using the original sales.
// Keep both ends of an identity in source order: coverage uses the last spelling
// for a store/SKU, while evidence matching also uses the first observed parent.
export function prepareProfitPageSales(sales) {
  const identities = new Map(), references = new Map();
  for (let i = 0; i < sales.length; i++) {
    const row = sales[i];
    const key = JSON.stringify([row.workspaceId,row.ledgerId,row.store,row.platformSku,row.sku,row.platformSkc,row.supplierNumber,row.attribute]);
    const ends = identities.get(key);
    if (ends) ends[1] = i; else identities.set(key,[i,i]);
    if (row.hasDirectUnitCost) references.set(`${row.groupKey ?? createLedgerGroupKey(row)}::${row.skuKey ?? createLedgerSkuKey(row)}`,
      new Decimal(row.directUnitCost ?? 0).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber());
  }
  const rows = [...new Set([...identities.values()].flat())].sort((a,b)=>a-b).map(i=>{
    const { workspaceId,ledgerId,store,platformSku,sku,platformSkc,supplierNumber,attribute } = sales[i];
    return { workspaceId,ledgerId,store,platformSku,sku,platformSkc,supplierNumber,attribute };
  });
  // The compact collection controls need product identities and totals, never a
  // list of all sale order IDs. Attribute evidence in the full editor remains raw.
  const lines = groupImportedSales(sales).map(({sourceRows,orderIds,...line})=>line);
  let groups, reportError;
  try { groups = groupReportSales(sales, true); }
  catch (error) { reportError = error.message; groups = []; }
  const wanted = new Set(groups.map(g=>g.sourceRows[0].id));
  const firstOrders = new Map();
  for (const row of sales) if (wanted.has(row.id)) firstOrders.set(row.id, row.order1688);
  return { rows, lines, groups, references, firstOrders, reportError };
}

// Keep native types and missing properties. Thousands of repeated product,
// shop and field strings otherwise exceed the disposable cache's 16 MiB limit.
function packRows(rows) {
  const columns = new Map(), minusZero = Symbol();
  rows.forEach((row,i) => {
    for (const key of Object.keys(row)) {
      if (!columns.has(key)) columns.set(key,{codes:new Uint32Array(rows.length),values:[],lookup:new Map()});
      const column=columns.get(key), value=row[key], k=Object.is(value,-0) ? minusZero : value;
      if (!column.lookup.has(k)) column.lookup.set(k,column.values.push(value));
      column.codes[i]=column.lookup.get(k);
    }
  });
  return {count:rows.length, columns:[...columns].map(([key,{codes,values}])=>[key,codes,values])};
}
function unpackRows({count,columns}) {
  const rows=Array.from({length:count},()=>({}));
  for (const [key,codes,values] of columns) for(let i=0;i<count;i++) if(codes[i])rows[i][key]=values[codes[i]-1];
  return rows;
}
export function packProfitSaleGroups(facts) {
  return {...facts,rows:packRows(facts.rows),lines:packRows(facts.lines),groups:packRows(facts.groups)};
}
export function unpackProfitSaleGroups(facts) {
  return {...facts,rows:unpackRows(facts.rows),lines:unpackRows(facts.lines),groups:unpackRows(facts.groups)};
}
