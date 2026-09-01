-- Shopeers core schema, constraints, immutable facts and RLS.
-- This migration is a reviewable source artifact. It is not executed by this repository.

create table public.workspaces (
  id text primary key,
  name text not null,
  default_currency char(3) not null default 'CNY' check (default_currency = 'CNY'),
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('admin', 'selection', 'operations', 'finance', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.products (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  english_title text,
  platform_skc text,
  canonical_platform_skc text,
  store text,
  image_url text,
  supplier_code text,
  supplier_name text,
  source_product_id text,
  source_url text,
  status text not null default 'draft' check (status in ('active', 'draft', 'inactive', 'deleted')),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.platform_skus (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  product_id text not null,
  platform_skc text,
  canonical_platform_skc text,
  platform_sku text not null,
  canonical_platform_sku text not null,
  source_sku text,
  attribute text,
  status text not null default 'draft' check (status in ('active', 'draft', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, canonical_platform_sku),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade
);

create table public.supplier_offers (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  product_id text not null,
  platform_sku_id text,
  platform_sku text not null,
  canonical_platform_sku text not null,
  source text not null default '1688' check (source = '1688'),
  source_product_id text,
  source_url text,
  supplier_code text,
  supplier_name text,
  purchase_unit_price numeric(18, 6),
  shipping_amount numeric(18, 6) not null default 0 check (shipping_amount >= 0),
  handling_fee numeric(18, 6) not null default 0 check (handling_fee >= 0),
  purchase_pack_count numeric(18, 6),
  total_purchase_packs numeric(18, 6),
  units_per_pack numeric(18, 6) not null default 1 check (units_per_pack > 0),
  landed_unit_cost numeric(18, 6) check (landed_unit_cost is null or landed_unit_cost > 0),
  reference_unit_cost numeric(18, 6) check (reference_unit_cost is null or reference_unit_cost > 0),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  input_snapshot jsonb not null default '{}'::jsonb,
  calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, platform_sku_id) references public.platform_skus(workspace_id, id) on delete set null
);

create table public.captures (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  request_id text not null,
  batch_id text,
  source text not null default '1688' check (source = '1688'),
  source_product_id text,
  source_url text,
  source_title text,
  image_url text,
  supplier_code text,
  status text not null check (status in ('pending', 'blocked', 'needs_review', 'draft', 'confirmed', 'ignored')),
  draft jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  captured_by text not null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.ledgers (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  type text not null default 'monthly_profit' check (type = 'monthly_profit'),
  status text not null default 'draft' check (status in ('draft', 'cost_pending', 'approval_pending', 'ready', 'finalized', 'locked')),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  warehouse_rate numeric(18, 6) not null default 0.70 check (warehouse_rate >= 0),
  summary jsonb not null default '{}'::jsonb,
  cost_summary jsonb not null default '{}'::jsonb,
  profit_summary jsonb,
  formula_version text,
  finalized_at timestamptz,
  finalized_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, period, type),
  unique (workspace_id, id)
);

create table public.import_batches (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  ledger_id text not null,
  file_name text not null,
  file_hash text,
  mapping jsonb not null default '{}'::jsonb,
  status text not null check (status in ('completed', 'failed')),
  store text,
  period text not null,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  valid_row_count integer not null default 0 check (valid_row_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  skipped_row_count integer not null default 0 check (skipped_row_count >= 0),
  replaced_group_count integer not null default 0 check (replaced_group_count >= 0),
  added_group_count integer not null default 0 check (added_group_count >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade
);

create table public.sales_rows (
  id bigint generated by default as identity primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  ledger_id text not null,
  batch_id text not null,
  group_key text not null,
  sku_key text,
  store text not null,
  supplier_number text,
  platform_skc text,
  canonical_platform_skc text,
  platform_sku text not null,
  canonical_platform_sku text not null,
  attribute text,
  order_id text,
  order_date date,
  quantity numeric(18, 6) not null default 0,
  revenue numeric(18, 6) not null default 0,
  penalty numeric(18, 6) not null default 0,
  is_deduction boolean not null default false,
  source_row integer,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, batch_id) references public.import_batches(workspace_id, id) on delete cascade
);

create table public.erp_cost_requests (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  ledger_id text,
  platform_skcs jsonb not null,
  query_unit text not null default 'platform_skc' check (query_unit = 'platform_skc'),
  status text not null check (status in ('draft', 'copied', 'running', 'failed', 'completed', 'published')),
  requested_by text not null,
  requested_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete set null
);

create table public.erp_cost_batches (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  ledger_id text not null,
  request_id text,
  source_name text not null,
  input_hash text,
  status text not null check (status in ('completed', 'published', 'failed')),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  summary jsonb not null default '{}'::jsonb,
  source_contract jsonb,
  published_by text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, request_id) references public.erp_cost_requests(workspace_id, id) on delete set null
);

create table public.erp_cost_rows (
  id bigint generated by default as identity primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  batch_id text not null,
  ledger_id text not null,
  platform_sku text not null,
  canonical_platform_sku text not null,
  platform_skc text,
  canonical_platform_skc text,
  warehouse_sku text,
  unit_cost numeric(18, 6) not null check (unit_cost > 0),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  order_number text,
  order_type text,
  total_quantity numeric(18, 6),
  total_price numeric(18, 6),
  selected_record_ids jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  foreign key (workspace_id, batch_id) references public.erp_cost_batches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade
);

create table public.cost_approvals (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  ledger_id text not null,
  platform_sku text not null,
  canonical_platform_sku text not null,
  reference_cost_id text not null,
  approved_amount numeric(18, 6) not null check (approved_amount > 0),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  reason text not null,
  approved_by text not null,
  approved_at timestamptz not null,
  status text not null check (status in ('approved', 'revoked')),
  reference_snapshot jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  unique (workspace_id, id),
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade
);

create table public.profit_lines (
  id bigint generated by default as identity primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  ledger_id text not null,
  platform_sku text not null,
  canonical_platform_sku text not null,
  platform_skc text,
  store text not null,
  attribute text,
  quantity numeric(18, 6) not null default 0,
  revenue numeric(18, 6) not null default 0,
  penalty numeric(18, 6) not null default 0,
  formal_cost_source text not null check (formal_cost_source in ('erp', 'approved_1688')),
  formal_unit_cost numeric(18, 6) not null check (formal_unit_cost > 0),
  purchase_cost numeric(18, 6) not null,
  warehouse_cost numeric(18, 6) not null,
  profit numeric(18, 6) not null,
  profit_rate numeric(18, 6),
  cost_batch_id text,
  cost_approval_id text,
  calculation_mode text not null default 'exact' check (calculation_mode = 'exact'),
  formula_version text not null,
  finalized_at timestamptz not null,
  finalized_by text not null,
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, cost_batch_id) references public.erp_cost_batches(workspace_id, id) on delete cascade,
  foreign key (cost_approval_id) references public.cost_approvals(id) on delete cascade
);

create table public.audit_events (
  id bigint generated by default as identity primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  event_id text not null,
  object_type text not null,
  object_id text not null,
  action text not null,
  actor_id text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  content_hash text not null,
  created_at timestamptz not null,
  sync_version text,
  received_at timestamptz not null default now(),
  unique (workspace_id, event_id)
);

create table public.cloud_seed_imports (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  seed_fingerprint text not null,
  import_version text not null,
  inserted_count integer not null default 0 check (inserted_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  table_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, seed_fingerprint)
);

create index platform_skus_workspace_skc on public.platform_skus (workspace_id, canonical_platform_skc);
create index sales_rows_ledger_group on public.sales_rows (workspace_id, ledger_id, group_key);
create index sales_rows_ledger_skc on public.sales_rows (workspace_id, ledger_id, canonical_platform_skc);
create index erp_cost_rows_ledger_sku on public.erp_cost_rows (workspace_id, ledger_id, canonical_platform_sku, published_at desc);
create index cost_approvals_ledger_sku on public.cost_approvals (workspace_id, ledger_id, canonical_platform_sku, status);
create index audit_events_workspace_created on public.audit_events (workspace_id, created_at desc);
create index cloud_seed_imports_workspace_created on public.cloud_seed_imports (workspace_id, created_at desc);
create index workspace_members_user_workspace on public.workspace_members (user_id, workspace_id, status);

create or replace function public.is_workspace_member(target_workspace text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  );
$$;

create or replace function public.has_workspace_role(target_workspace text, allowed_roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role = any(allowed_roles)
  );
$$;

create or replace function public.reject_immutable_mutation()
returns trigger language plpgsql security invoker
as $$
begin
  raise exception '该事实或审计记录不可修改，只能追加新版本';
end;
$$;

create or replace function public.reject_fact_mutation_except_parent_cascade()
returns trigger language plpgsql security invoker
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '该事实记录不可修改，只能追加新版本';
  end if;
  if exists (
    select 1 from public.ledgers l
    where l.workspace_id = old.workspace_id and l.id = old.ledger_id
  ) then
    raise exception '事实记录不能单独删除，只能随未定稿账本整体删除';
  end if;
  return old;
end;
$$;

create or replace function public.assert_ledger_deletable()
returns trigger language plpgsql security invoker
as $$
begin
  if old.status in ('finalized', 'locked') then
    raise exception '已定稿或已锁定账本不能删除';
  end if;
  return old;
end;
$$;

create or replace function public.assert_ledger_editable()
returns trigger language plpgsql security invoker
as $$
declare
  target_ledger text;
  ledger_status text;
begin
  target_ledger := case when tg_op = 'DELETE' then old.ledger_id else new.ledger_id end;
  select l.status into ledger_status from public.ledgers l where l.id = target_ledger;
  if ledger_status in ('finalized', 'locked') then
    raise exception '已定稿或已锁定账本不能修改';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger erp_cost_rows_immutable before update or delete on public.erp_cost_rows
for each row execute function public.reject_fact_mutation_except_parent_cascade();
create trigger profit_lines_immutable before update or delete on public.profit_lines
for each row execute function public.reject_fact_mutation_except_parent_cascade();
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function public.reject_immutable_mutation();
create trigger ledgers_delete_guard before delete on public.ledgers
for each row execute function public.assert_ledger_deletable();
create trigger sales_rows_ledger_editable before insert or update or delete on public.sales_rows
for each row execute function public.assert_ledger_editable();
create trigger erp_cost_rows_ledger_editable before insert on public.erp_cost_rows
for each row execute function public.assert_ledger_editable();
create trigger cost_approvals_ledger_editable before insert or update on public.cost_approvals
for each row execute function public.assert_ledger_editable();
create trigger profit_lines_ledger_editable before insert on public.profit_lines
for each row execute function public.assert_ledger_editable();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.products enable row level security;
alter table public.platform_skus enable row level security;
alter table public.supplier_offers enable row level security;
alter table public.captures enable row level security;
alter table public.ledgers enable row level security;
alter table public.import_batches enable row level security;
alter table public.sales_rows enable row level security;
alter table public.erp_cost_requests enable row level security;
alter table public.erp_cost_batches enable row level security;
alter table public.erp_cost_rows enable row level security;
alter table public.cost_approvals enable row level security;
alter table public.profit_lines enable row level security;
alter table public.audit_events enable row level security;
alter table public.cloud_seed_imports enable row level security;

alter table public.workspaces force row level security;
alter table public.workspace_members force row level security;
alter table public.products force row level security;
alter table public.platform_skus force row level security;
alter table public.supplier_offers force row level security;
alter table public.captures force row level security;
alter table public.ledgers force row level security;
alter table public.import_batches force row level security;
alter table public.sales_rows force row level security;
alter table public.erp_cost_requests force row level security;
alter table public.erp_cost_batches force row level security;
alter table public.erp_cost_rows force row level security;
alter table public.cost_approvals force row level security;
alter table public.profit_lines force row level security;
alter table public.audit_events force row level security;
alter table public.cloud_seed_imports force row level security;

create policy workspaces_read on public.workspaces for select to authenticated using ((select public.is_workspace_member(id)));
create policy workspaces_update on public.workspaces for update to authenticated using ((select public.has_workspace_role(id, array['admin']))) with check ((select public.has_workspace_role(id, array['admin'])));
create policy members_read on public.workspace_members for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy members_write on public.workspace_members for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin']))) with check ((select public.has_workspace_role(workspace_id, array['admin'])));

create policy products_read on public.products for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy products_write on public.products for insert to authenticated with check ((select public.has_workspace_role(workspace_id, array['admin','selection'])));
create policy products_update on public.products for update to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','selection']))) with check ((select public.has_workspace_role(workspace_id, array['admin','selection'])));
create policy skus_read on public.platform_skus for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy skus_write on public.platform_skus for insert to authenticated with check ((select public.has_workspace_role(workspace_id, array['admin','selection'])));
create policy skus_update on public.platform_skus for update to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','selection']))) with check ((select public.has_workspace_role(workspace_id, array['admin','selection'])));
create policy skus_delete on public.platform_skus for delete to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','selection'])));
create policy offers_read on public.supplier_offers for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy offers_write on public.supplier_offers for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','selection']))) with check ((select public.has_workspace_role(workspace_id, array['admin','selection'])));
create policy captures_read on public.captures for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy captures_write on public.captures for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','selection','operations']))) with check ((select public.has_workspace_role(workspace_id, array['admin','selection','operations'])));

create policy ledgers_read on public.ledgers for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy ledgers_write on public.ledgers for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','operations','finance']))) with check ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])));
create policy imports_read on public.import_batches for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy imports_write on public.import_batches for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','operations']))) with check ((select public.has_workspace_role(workspace_id, array['admin','operations'])));
create policy sales_read on public.sales_rows for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy sales_write on public.sales_rows for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','operations']))) with check ((select public.has_workspace_role(workspace_id, array['admin','operations'])));
create policy erp_requests_read on public.erp_cost_requests for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy erp_requests_write on public.erp_cost_requests for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','operations']))) with check ((select public.has_workspace_role(workspace_id, array['admin','operations'])));
create policy erp_batches_read on public.erp_cost_batches for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy erp_batches_write on public.erp_cost_batches for insert to authenticated with check ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])));
create policy erp_rows_read on public.erp_cost_rows for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy erp_rows_write on public.erp_cost_rows for insert to authenticated with check ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])));
create policy approvals_read on public.cost_approvals for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy approvals_write on public.cost_approvals for insert to authenticated with check ((select public.has_workspace_role(workspace_id, array['admin','finance'])));
create policy approvals_update on public.cost_approvals for update to authenticated using ((select public.has_workspace_role(workspace_id, array['admin','finance']))) with check ((select public.has_workspace_role(workspace_id, array['admin','finance'])));
create policy profits_read on public.profit_lines for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy profits_write on public.profit_lines for insert to authenticated with check ((select public.has_workspace_role(workspace_id, array['admin','finance'])));
create policy audit_read on public.audit_events for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy audit_insert on public.audit_events for insert to authenticated with check ((select public.is_workspace_member(workspace_id)));
create policy cloud_seed_imports_read on public.cloud_seed_imports for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy cloud_seed_imports_write on public.cloud_seed_imports for all to authenticated using ((select public.has_workspace_role(workspace_id, array['admin']))) with check ((select public.has_workspace_role(workspace_id, array['admin'])));
