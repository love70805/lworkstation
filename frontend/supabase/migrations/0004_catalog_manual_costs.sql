-- SKU-level confirmed reference costs for the selection catalog.
-- These records are deliberately excluded from monthly formal-cost decisions.

create table public.catalog_manual_costs (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  product_id text not null,
  platform_sku_id text not null,
  platform_sku text not null,
  canonical_platform_sku text not null,
  amount numeric(18, 6) not null check (amount > 0),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  kind text not null default 'manual_confirmed' check (kind = 'manual_confirmed'),
  status text not null default 'active' check (status in ('active', 'superseded')),
  note text not null default '',
  confirmed_by text not null,
  confirmed_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade,
  foreign key (workspace_id, platform_sku_id) references public.platform_skus(workspace_id, id) on delete cascade
);

create index catalog_manual_costs_workspace_product_sku
  on public.catalog_manual_costs (workspace_id, product_id, canonical_platform_sku, confirmed_at desc);

create unique index catalog_manual_costs_one_active_per_sku
  on public.catalog_manual_costs (workspace_id, canonical_platform_sku)
  where status = 'active';

alter table public.catalog_manual_costs enable row level security;
alter table public.catalog_manual_costs force row level security;

create policy catalog_manual_costs_read on public.catalog_manual_costs for select to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and exists (
      select 1 from public.products p
      where p.workspace_id = catalog_manual_costs.workspace_id
        and p.id = catalog_manual_costs.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin','operations','finance']))
        )
    )
  );

create policy catalog_manual_costs_write on public.catalog_manual_costs for all to authenticated
  using (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and exists (
      select 1 from public.products p
      where p.workspace_id = catalog_manual_costs.workspace_id
        and p.id = catalog_manual_costs.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin']))
        )
    )
  )
  with check (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and exists (
      select 1 from public.products p
      where p.workspace_id = catalog_manual_costs.workspace_id
        and p.id = catalog_manual_costs.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin']))
        )
    )
  );
