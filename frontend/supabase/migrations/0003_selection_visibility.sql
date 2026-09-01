-- Selection catalog visibility and ownership.
-- Product/capture privacy is scoped to selection records only; ledgers and
-- profit facts remain workspace-shared for monthly accounting.

alter table public.products
  add column if not exists owner_id text,
  add column if not exists visibility text not null default 'workspace'
    check (visibility in ('workspace', 'private'));

alter table public.captures
  add column if not exists owner_id text,
  add column if not exists visibility text not null default 'workspace'
    check (visibility in ('workspace', 'private'));

create index if not exists products_workspace_visibility_owner
  on public.products (workspace_id, visibility, owner_id);

create index if not exists captures_workspace_visibility_owner
  on public.captures (workspace_id, visibility, owner_id);

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin','operations','finance']))
    )
  );

drop policy if exists products_write on public.products;
create policy products_write on public.products for insert to authenticated
  with check (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin']))
    )
  );

drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin']))
    )
  )
  with check (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin']))
    )
  );

drop policy if exists captures_read on public.captures;
create policy captures_read on public.captures for select to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin','operations','finance']))
    )
  );

drop policy if exists captures_write on public.captures;
create policy captures_write on public.captures for all to authenticated
  using (
    (select public.has_workspace_role(workspace_id, array['admin','selection','operations']))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin']))
    )
  )
  with check (
    (select public.has_workspace_role(workspace_id, array['admin','selection','operations']))
    and (
      visibility = 'workspace'
      or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin']))
    )
  );

-- Child catalog rows inherit the visibility of their parent product. Without
-- these policies a direct query of platform_skus or supplier_offers could
-- reveal a private product even when products itself was filtered.
drop policy if exists skus_read on public.platform_skus;
drop policy if exists skus_update on public.platform_skus;
drop policy if exists skus_delete on public.platform_skus;
create policy skus_read on public.platform_skus for select to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and exists (
      select 1 from public.products p
      where p.workspace_id = platform_skus.workspace_id
        and p.id = platform_skus.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin','operations','finance']))
        )
    )
  );

drop policy if exists skus_write on public.platform_skus;
create policy skus_write on public.platform_skus for all to authenticated
  using (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and exists (
      select 1 from public.products p
      where p.workspace_id = platform_skus.workspace_id
        and p.id = platform_skus.product_id
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
      where p.workspace_id = platform_skus.workspace_id
        and p.id = platform_skus.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin']))
        )
    )
  );

drop policy if exists offers_read on public.supplier_offers;
create policy offers_read on public.supplier_offers for select to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and exists (
      select 1 from public.products p
      where p.workspace_id = supplier_offers.workspace_id
        and p.id = supplier_offers.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin','operations','finance']))
        )
    )
  );

drop policy if exists offers_write on public.supplier_offers;
create policy offers_write on public.supplier_offers for all to authenticated
  using (
    (select public.has_workspace_role(workspace_id, array['admin','selection']))
    and exists (
      select 1 from public.products p
      where p.workspace_id = supplier_offers.workspace_id
        and p.id = supplier_offers.product_id
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
      where p.workspace_id = supplier_offers.workspace_id
        and p.id = supplier_offers.product_id
        and (
          p.visibility = 'workspace'
          or p.owner_id = (select auth.uid()::text)
          or (select public.has_workspace_role(p.workspace_id, array['admin']))
        )
    )
  );
