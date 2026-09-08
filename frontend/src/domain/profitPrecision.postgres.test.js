// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("widens profit amounts without changing old facts or weakening finalized guards", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;`);
    const directory = new URL("../../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql") && name < "0011").sort()) {
      await db.exec(await readFile(new URL(file, directory), "utf8"));
    }
    await db.exec(`insert into public.workspaces(id,name) values ('precision','精度测试');
      insert into public.ledgers(id,workspace_id,period,created_by) values ('old','precision','2026-07','qa'),('new','precision','2026-08','qa');`);
    const insert = `insert into public.profit_lines(workspace_id,ledger_id,platform_sku,canonical_platform_sku,store,
      quantity,revenue,formal_cost_source,formal_unit_cost,purchase_cost,warehouse_cost,profit,formula_version,finalized_at,finalized_by)
      values('precision',$1,'SKU','SKU','店铺',1.234567,0,'erp',1.2345,$2,0,$3,'test',now(),'qa')`;
    await db.query(insert, ["old", "1.524073", "-1.524073"]);
    await db.exec("update public.ledgers set status='finalized' where id='old'");
    const before = (await db.query("select purchase_cost::text,profit::text from public.profit_lines where ledger_id='old'")).rows;
    await db.exec(await readFile(new URL("0011_profit_line_exact_amounts.sql", directory), "utf8"));
    expect((await db.query("select purchase_cost::text,profit::text from public.profit_lines where ledger_id='old'")).rows).toEqual(before);
    await db.query(insert, ["new", "1.5240729615", "-1.5240729615"]);
    expect((await db.query("select purchase_cost::text,profit::text,quantity*formal_unit_cost=purchase_cost as exact from public.profit_lines where ledger_id='new'")).rows[0])
      .toEqual({ purchase_cost: "1.5240729615", profit: "-1.5240729615", exact: true });
    await db.exec("update public.ledgers set status='finalized' where id='new'");
    await expect(db.exec("update public.profit_lines set profit=0 where ledger_id='new'")).rejects.toThrow();
    await expect(db.exec("delete from public.profit_lines where ledger_id='old'")).rejects.toThrow();
    await expect(db.query(insert, ["old", "1", "-1"])).rejects.toThrow();
  } finally { await db.close(); }
}, 30000);
