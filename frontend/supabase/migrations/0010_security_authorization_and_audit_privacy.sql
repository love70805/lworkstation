-- Forward-only security repair. Stored audit snapshots and hashes are unchanged.

create or replace function public.audit_snapshot_visible_to(value jsonb, actor text)
returns boolean language plpgsql immutable set search_path = public
as $$
declare child jsonb;
begin
  if value is null or value = 'null'::jsonb then return true; end if;
  if jsonb_typeof(value) = 'object' then
    if value->>'visibility' = 'private'
      and coalesce(value->>'ownerId', value->>'owner_id', '') is distinct from coalesce(actor, '') then
      return false;
    end if;
    if value->>'visibility' = 'private' and coalesce(actor, '') = '' then return false; end if;
    for child in select v from jsonb_each(value) as t(k, v) loop
      if not public.audit_snapshot_visible_to(child, actor) then return false; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select v from jsonb_array_elements(value) as t(v) loop
      if not public.audit_snapshot_visible_to(child, actor) then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

-- Deleted objects keep their last recorded visibility/owner through immutable
-- audit snapshots. Missing current rows must neither expose earlier public
-- snapshots nor hide the owner's complete history (including SKU references).
create or replace function public.catalog_entity_visible_to(entity_type text, target_workspace text, entity_id text, actor text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare current_object record; last_snapshot jsonb;
begin
  if entity_type = 'product' then
    select p.workspace_id, p.visibility, p.owner_id into current_object from public.products p where p.id = entity_id;
  elsif entity_type = 'capture' then
    select c.workspace_id, c.visibility, c.owner_id into current_object from public.captures c where c.id = entity_id;
  else return false;
  end if;
  if current_object.workspace_id is not null then
    return current_object.workspace_id = target_workspace
      and (current_object.visibility = 'workspace' or current_object.owner_id = actor);
  end if;

  select state.snapshot into last_snapshot from public.audit_events a
    cross join lateral (select case
      when a.action = 'product_deleted' then coalesce(a.before_snapshot #> '{snapshot,product}', a.before_snapshot->'snapshot', a.before_snapshot->'product', a.before_snapshot)
      when entity_type = 'product' then coalesce(a.after_snapshot #> '{snapshot,product}', a.after_snapshot->'product')
      else coalesce(a.after_snapshot->'snapshot', a.after_snapshot)
    end as snapshot) state
    where a.workspace_id = target_workspace and a.object_id = entity_id
      and ((entity_type = 'product' and a.action in ('product_created','product_updated','product_merged','product_deleted'))
        or (entity_type = 'capture' and a.action in ('capture_created','capture_draft_saved','capture_confirmed','capture_ignored','capture_product_relinked')))
      and state.snapshot->>'id' = entity_id
    -- Server-assigned insertion order follows applied state; client clocks do not.
    order by a.id desc limit 1;
  if last_snapshot is null then return false; end if;
  return coalesce(last_snapshot->>'visibility', last_snapshot #>> '{draft,visibility}', 'workspace') = 'workspace'
    or coalesce(last_snapshot->>'ownerId', last_snapshot->>'owner_id', last_snapshot #>> '{draft,ownerId}') = actor;
end;
$$;

create or replace function public.audit_catalog_references_visible_to(value jsonb, target_workspace text, actor text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare child jsonb; pair record; product_ref text;
begin
  if value is null or value = 'null'::jsonb then return true; end if;
  if jsonb_typeof(value) = 'object' then
    for pair in select k, v from jsonb_each(value) as t(k, v) loop
      if pair.k in ('productId', 'product_id', 'confirmedProductId') then
        product_ref := nullif(pair.v #>> '{}', '');
        if product_ref is not null and not public.catalog_entity_visible_to('product', target_workspace, product_ref, actor)
          then return false; end if;
      elsif pair.k = 'productIds' and jsonb_typeof(pair.v) = 'array' then
        for child in select v from jsonb_array_elements(pair.v) as t(v) loop
          if not public.catalog_entity_visible_to('product', target_workspace, child #>> '{}', actor)
            then return false; end if;
        end loop;
      end if;
      if not public.audit_catalog_references_visible_to(pair.v, target_workspace, actor) then return false; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select v from jsonb_array_elements(value) as t(v) loop
      if not public.audit_catalog_references_visible_to(child, target_workspace, actor) then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

create or replace function public.audit_event_visible_to(
  target_workspace text, event_action text, event_type text, event_object text,
  before_value jsonb, after_value jsonb, actor text
)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare member_role text; catalog_event boolean; parent_id text;
begin
  select wm.role into member_role from public.workspace_members wm
    where wm.workspace_id = target_workspace and wm.user_id::text = actor and wm.status = 'active';
  if member_role is null then return false; end if;
  if member_role in ('admin', 'operations', 'finance') then return true; end if;
  if not public.audit_snapshot_visible_to(before_value, actor)
    or not public.audit_snapshot_visible_to(after_value, actor) then return false; end if;

  catalog_event := event_type in ('product', 'capture', 'catalog_manual_cost')
    or event_action in ('product_created', 'product_updated', 'product_deleted', 'product_merged',
      'product_sales_status_bulk_updated', 'capture_created', 'capture_draft_saved', 'capture_confirmed',
      'capture_ignored', 'capture_product_relinked', 'catalog_manual_cost_confirmed', 'catalog_manual_cost_relinked');
  if not catalog_event then return true; end if;
  if not public.audit_catalog_references_visible_to(before_value, target_workspace, actor)
    or not public.audit_catalog_references_visible_to(after_value, target_workspace, actor) then return false; end if;
  if event_action in ('product_created','product_updated','product_merged','product_deleted') or event_type = 'product' then
    return public.catalog_entity_visible_to('product', target_workspace, event_object, actor);
  elsif event_action in ('capture_created','capture_draft_saved','capture_confirmed','capture_ignored','capture_product_relinked') or event_type = 'capture' then
    return public.catalog_entity_visible_to('capture', target_workspace, event_object, actor);
  elsif event_action in ('catalog_manual_cost_confirmed','catalog_manual_cost_relinked') or event_type = 'catalog_manual_cost' then
    select c.product_id into parent_id from public.catalog_manual_costs c
      where c.workspace_id = target_workspace and c.id = event_object;
    parent_id := coalesce(parent_id, after_value #>> '{snapshot,catalogManualCost,productId}',
      after_value #>> '{snapshot,productId}', after_value #>> '{catalogManualCost,productId}', after_value->>'productId',
      before_value #>> '{snapshot,catalogManualCost,productId}', before_value #>> '{snapshot,productId}');
    return coalesce(public.catalog_entity_visible_to('product', target_workspace, parent_id, actor), false);
  end if;
  return true;
end;
$$;

create or replace function public.can_read_audit_event(
  target_workspace text, event_action text, event_type text, event_object text,
  before_value jsonb, after_value jsonb
)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.audit_event_visible_to(target_workspace, event_action, event_type, event_object,
    before_value, after_value, (select auth.uid()::text));
$$;

drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events for select to authenticated
  using (public.can_read_audit_event(workspace_id, action, object_type, object_id, before_snapshot, after_snapshot));

-- Clients submit audits through the validated sync API. A direct REST insert
-- must not forge another actor, shadow an event ID, or bypass action validation.
drop policy if exists audit_insert on public.audit_events;
revoke insert on public.audit_events from authenticated, anon;

-- This function runs inside the sync transaction after the workspace row lock.
-- The service connection may bypass RLS, so identity/ownership are checked again.
create or replace function public.assert_catalog_sync_access(
  target_workspace text, event_action text, event_object text, snapshot jsonb, actor text
)
returns void language plpgsql security definer set search_path = public
as $$
declare member_role text; existing record; candidate jsonb; parent_id text;
begin
  select wm.role into member_role from public.workspace_members wm
    where wm.workspace_id = target_workspace and wm.user_id::text = actor and wm.status = 'active';
  if member_role is null then raise exception '工作区成员无效' using errcode = '42501'; end if;

  if event_action = 'selection_status_definitions_updated' then
    if member_role <> 'admin' or event_object <> target_workspace then
      raise exception '无权修改工作区配置' using errcode = '42501';
    end if;
    return;
  elsif event_action in ('capture_created', 'capture_draft_saved', 'capture_confirmed', 'capture_ignored', 'capture_product_relinked') then
    if member_role not in ('admin', 'selection', 'operations') then
      raise exception '无权修改采集记录' using errcode = '42501';
    end if;
    select c.workspace_id, c.owner_id, c.visibility into existing from public.captures c where c.id = event_object for update;
    candidate := snapshot || jsonb_build_object(
      'visibility', coalesce(snapshot->>'visibility', snapshot->'draft'->>'visibility', 'workspace'),
      'ownerId', coalesce(snapshot->>'ownerId', snapshot->'draft'->>'ownerId'));
  elsif event_action in ('product_created', 'product_updated', 'product_merged', 'product_deleted') then
    if member_role not in ('admin', 'selection') then
      raise exception '无权修改商品' using errcode = '42501';
    end if;
    select p.workspace_id, p.owner_id, p.visibility into existing from public.products p where p.id = event_object for update;
    candidate := snapshot->'product';
  elsif event_action in ('catalog_manual_cost_confirmed', 'catalog_manual_cost_relinked') then
    if member_role not in ('admin', 'selection') then
      raise exception '无权修改选品人工成本' using errcode = '42501';
    end if;
    select c.workspace_id, p.owner_id, p.visibility into existing from public.catalog_manual_costs c
      join public.products p on p.workspace_id = c.workspace_id and p.id = c.product_id
      where c.id = event_object for update of c, p;
    candidate := coalesce(snapshot->'catalogManualCost', snapshot);
  else
    raise exception '未注册的选品同步动作' using errcode = '42501';
  end if;
  if existing.workspace_id is not null and (
    existing.workspace_id <> target_workspace
    or (member_role <> 'admin' and existing.visibility = 'private' and existing.owner_id is distinct from actor)
  ) then raise exception '无权修改该私有或跨工作区对象' using errcode = '42501'; end if;
  if member_role <> 'admin' and not public.audit_snapshot_visible_to(candidate, actor) then
    raise exception '无权写入他人的私有快照' using errcode = '42501';
  end if;
  if event_action in ('capture_created', 'capture_draft_saved', 'capture_confirmed', 'capture_ignored', 'capture_product_relinked')
    and member_role <> 'admin'
    and not public.audit_catalog_references_visible_to(candidate, target_workspace, actor) then
    raise exception '无权关联采集记录对应商品' using errcode = '42501';
  end if;
  if event_action in ('catalog_manual_cost_confirmed', 'catalog_manual_cost_relinked') then
    parent_id := candidate->>'productId';
    if not exists (select 1 from public.products p where p.id = parent_id and p.workspace_id = target_workspace
      and (member_role = 'admin' or p.visibility = 'workspace' or p.owner_id = actor)) then
      raise exception '无权访问人工成本对应商品' using errcode = '42501';
    end if;
    if not exists (select 1 from public.platform_skus s where s.workspace_id = target_workspace
      and s.product_id = parent_id and s.id = candidate->>'platformSkuId'
      and s.canonical_platform_sku = candidate->>'canonicalPlatformSku') then
      raise exception '人工成本 SKU 不属于对应商品' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Match the existing selection merge capability without granting viewer writes.
create policy products_delete on public.products for delete to authenticated
  using ((select public.has_workspace_role(workspace_id, array['admin','selection']))
    and (visibility = 'workspace' or owner_id = (select auth.uid()::text)
      or (select public.has_workspace_role(workspace_id, array['admin']))));

revoke all on function public.audit_catalog_references_visible_to(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.catalog_entity_visible_to(text, text, text, text) from public, anon, authenticated;
revoke all on function public.audit_event_visible_to(text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.assert_catalog_sync_access(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.can_read_audit_event(text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.audit_event_visible_to(text, text, text, text, jsonb, jsonb, text) to service_role;
grant execute on function public.assert_catalog_sync_access(text, text, text, jsonb, text) to service_role;
grant execute on function public.can_read_audit_event(text, text, text, text, jsonb, jsonb) to authenticated;
