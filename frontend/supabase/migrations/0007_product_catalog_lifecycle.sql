-- Catalog lifecycle fields remain selection-only metadata. They do not
-- participate in monthly formal-cost or profit calculations.

alter table public.products
  add column if not exists sales_platform text not null default '',
  add column if not exists publication_status text not null default 'unpublished'
    check (publication_status in (
      'unpublished',
      'published_pending_review',
      'approved_pending_listing',
      'listed',
      'off_shelf'
    ));

create index if not exists products_workspace_publication_status
  on public.products (workspace_id, publication_status, updated_at desc);

alter table public.platform_skus
  add column if not exists warehouse_sku text,
  add column if not exists canonical_warehouse_sku text;

create index if not exists platform_skus_workspace_canonical_warehouse_sku
  on public.platform_skus (workspace_id, canonical_warehouse_sku)
  where canonical_warehouse_sku is not null;
