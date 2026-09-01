import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectPostgresMigration } from "./postgresSchemaContract";

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
const migration = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).toSorted().map((file) => readFileSync(new URL(file, migrationsDir), "utf8")).join("\n");
const lifecycleMigration = readFileSync(new URL("0008_erp_cost_lifecycle.sql", migrationsDir), "utf8");
const voidTransitionMigration = readFileSync(new URL("0009_erp_cost_void_transition.sql", migrationsDir), "utf8");

describe("PostgreSQL migration contract", () => {
  it("contains all tenant tables, workspace columns, RLS and immutable fact guards", () => {
    const result = inspectPostgresMigration(migration);
    expect(result).toMatchObject({ valid: true, missingTables: [], missingWorkspaceColumns: [], missingRls: [], missingFragments: [], missingRolePolicies: [], forbidden: [] });
  });

  it("declares the controlled void and finalized-ledger reopen lifecycle without weakening ordinary fact immutability", () => {
    const statusConstraint = lifecycleMigration.match(/add constraint erp_cost_batches_status_check\s+check \(status in \(([^)]+)\)\)/i);
    expect(statusConstraint?.[1].match(/'[^']+'/g)).toEqual(["'completed'", "'published'", "'failed'", "'voided'"]);
    expect(lifecycleMigration).toContain("create table public.erp_cost_inbox");
    expect(lifecycleMigration).toContain("create or replace function public.reopen_ledger_for_cost_recalculation");
    expect(lifecycleMigration).toContain("只有已定稿账本可以走受控重开路径");
    expect(lifecycleMigration).toContain("revoke all on function public.reopen_ledger_for_cost_recalculation");
    expect(lifecycleMigration).toContain("create or replace function public.reject_fact_mutation_except_parent_cascade");
    expect(lifecycleMigration).toContain("raise exception '事实记录不能单独删除，只能随未定稿账本整体删除'");
  });

  it("allows only an immutable one-time published/applied to voided transition", () => {
    expect(voidTransitionMigration).toContain("current_setting('shopeers.void_batch_id', true) is distinct from old.id");
    expect(voidTransitionMigration).toContain("current_setting('shopeers.void_inbox_id', true) is distinct from old.id");
    expect(voidTransitionMigration).toContain("old.status <> 'published'");
    expect(voidTransitionMigration).toContain("new.status <> 'voided'");
    expect(voidTransitionMigration).toContain("old.status <> 'applied'");
    expect(voidTransitionMigration).toContain("create or replace function public.void_erp_cost_batch");
    expect(voidTransitionMigration).toContain("if affected <> 1 then raise exception 'ERP 正式成本批次作废冲突'");
    expect(voidTransitionMigration).toContain("if affected <> 1 then raise exception 'ERP 收件批次作废冲突'");
    expect(voidTransitionMigration).toContain("unique (workspace_id, applied_batch_id)");
    expect(voidTransitionMigration).toContain("voided_batch_id = applied_batch_id");
    expect(voidTransitionMigration).toContain("drop policy if exists erp_inbox_update");
    expect(voidTransitionMigration).toContain("drop policy if exists erp_batches_update");
  });

  it("rejects authenticated direct inserts of voided batches and inbox records", () => {
    const batchPolicy = voidTransitionMigration.match(/create policy erp_batches_write[\s\S]+?;\s*\n\s*drop policy if exists erp_inbox_insert/i)?.[0] ?? "";
    const inboxPolicy = voidTransitionMigration.match(/create policy erp_inbox_insert[\s\S]+?;\s*\n\s*drop policy if exists erp_inbox_update/i)?.[0] ?? "";
    expect(voidTransitionMigration).toContain("drop policy if exists erp_batches_write");
    expect(batchPolicy).toContain("status = 'published'");
    expect(batchPolicy).toContain("voided_at is null");
    expect(batchPolicy).toContain("nullif(trim(voided_by), '') is null");
    expect(batchPolicy).toContain("nullif(trim(void_reason), '') is null");
    expect(inboxPolicy).toContain("status = 'applied'");
    expect(inboxPolicy).toContain("applied_batch_id is not null");
    expect(inboxPolicy).toContain("applied_at is not null");
    expect(inboxPolicy).toContain("voided_batch_id is null");
    expect(inboxPolicy).toContain("voided_at is null");
    expect(inboxPolicy).toContain("nullif(trim(voided_by), '') is null");
    expect(inboxPolicy).toContain("nullif(trim(void_reason), '') is null");
    expect(voidTransitionMigration).toContain("grant execute on function public.void_erp_cost_batch");
    expect(voidTransitionMigration).toContain("to service_role");
  });

  it.each([
    "delivery_id", "batch_id", "ledger_id", "request_id", "envelope", "applied_batch_id", "applied_at",
  ])("protects persisted inbox evidence field %s from mutation", (field) => {
    expect(voidTransitionMigration).toContain(`new.${field} is distinct from old.${field}`);
  });

  it.each([
    "id", "workspace_id", "ledger_id", "request_id", "source_name", "input_hash", "currency", "summary",
    "source_contract", "published_by", "published_at", "created_at",
  ])("protects persisted formal batch field %s from mutation", (field) => {
    expect(voidTransitionMigration).toContain(`new.${field} is distinct from old.${field}`);
  });

  it("requires complete void metadata and guards ledger deletion against inbox-only lifecycle evidence", () => {
    expect(voidTransitionMigration).toContain("voided_at is not null");
    expect(voidTransitionMigration).toContain("nullif(trim(voided_by), '') is not null");
    expect(voidTransitionMigration).toContain("nullif(trim(void_reason), '') is not null");
    expect(voidTransitionMigration).toContain("i.status in ('applied', 'voided')");
    expect(voidTransitionMigration).toContain("存在已发布或已作废 ERP 正式成本生命周期的账本不能物理删除");
  });
});
