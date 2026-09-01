-- Keep supplier quotations as append-only versions. The active version remains
-- the only one used for catalog reference cost; superseded versions are audit history.

alter table public.supplier_offers
  add column if not exists source_sku text,
  add column if not exists supplier_id text,
  add column if not exists offer_key text,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'superseded')),
  add column if not exists superseded_at timestamptz;

update public.supplier_offers
set supplier_id = coalesce(
  nullif(supplier_id, ''),
  'SUP-' || coalesce(nullif(lower(concat_ws(chr(31), supplier_code, supplier_name, source_product_id, source_url)), ''), id)
)
where supplier_id is null or supplier_id = '';

update public.supplier_offers
set offer_key = product_id || chr(31) || supplier_id || chr(31) || canonical_platform_sku
where offer_key is null or offer_key = '';

alter table public.supplier_offers
  alter column offer_key set not null;

create index if not exists supplier_offers_workspace_product_status
  on public.supplier_offers (workspace_id, product_id, status, canonical_platform_sku);

create unique index if not exists supplier_offers_one_active_version
  on public.supplier_offers (workspace_id, offer_key)
  where status = 'active';
