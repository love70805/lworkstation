-- Selection catalog fields introduced by the integrated product workbench.
-- The migration is intentionally additive so existing workspaces keep their data.

alter table public.platform_skus
  add column if not exists sale_price numeric(18, 6)
  check (sale_price is null or sale_price >= 0);

alter table public.platform_skus
  add column if not exists image_url text;

create index if not exists platform_skus_workspace_sale_price
  on public.platform_skus (workspace_id, sale_price);
