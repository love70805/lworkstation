-- Preserve the ERP formal-cost lifecycle in PostgreSQL. Formal evidence is
-- never physically deleted; finalized ledgers can only be reopened by the
-- audited sync service path.

alter table public.erp_cost_batches
  drop constraint if exists erp_cost_batches_status_check;

alter table public.erp_cost_batches
  add constraint erp_cost_batches_status_check
  check (status in ('completed', 'published', 'failed', 'voided'));

create table public.erp_cost_inbox (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  delivery_id text not null,
  batch_id text not null,
  ledger_id text not null,
  request_id text,
  status text not null check (status in ('pending', 'loaded', 'applied', 'rejected', 'voided')),
  received_via text not null,
  sent_at timestamptz,
  received_at timestamptz not null,
  envelope jsonb not null,
  applied_batch_id text,
  voided_batch_id text,
  applied_at timestamptz,
  rejected_at timestamptz,
  rejected_by text,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, delivery_id),
  foreign key (workspace_id, ledger_id) references public.ledgers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, request_id) references public.erp_cost_requests(workspace_id, id) on delete set null,
  foreign key (workspace_id, applied_batch_id) references public.erp_cost_batches(workspace_id, id) on delete restrict,
  foreign key (workspace_id, voided_batch_id) references public.erp_cost_batches(workspace_id, id) on delete restrict,
  check (status not in ('applied', 'voided') or applied_batch_id is not null),
  check (status <> 'voided' or voided_batch_id = applied_batch_id)
);

create index erp_cost_inbox_workspace_ledger_status
  on public.erp_cost_inbox (workspace_id, ledger_id, status, received_at);

create or replace function public.assert_ledger_deletable()
returns trigger language plpgsql security invoker
as $$
begin
  if old.status in ('finalized', 'locked') then
    raise exception '已定稿或已锁定账本不能删除';
  end if;
  if exists (
    select 1
    from public.erp_cost_batches b
    where b.workspace_id = old.workspace_id
      and b.ledger_id = old.id
      and b.status in ('published', 'voided')
  ) then
    raise exception '存在已发布或已作废 ERP 正式成本的账本不能物理删除';
  end if;
  return old;
end;
$$;

create or replace function public.reject_fact_mutation_except_parent_cascade()
returns trigger language plpgsql security invoker
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '该事实记录不可修改，只能追加新版本';
  end if;
  if tg_table_name = 'profit_lines'
    and current_setting('shopeers.reopen_workspace_id', true) = old.workspace_id
    and current_setting('shopeers.reopen_ledger_id', true) = old.ledger_id then
    return old;
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

create or replace function public.reopen_ledger_for_cost_recalculation(
  target_workspace text,
  target_ledger text,
  target_status text,
  target_summary jsonb,
  target_cost_summary jsonb,
  target_updated_at timestamptz,
  reopen_reason text
)
returns public.ledgers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_ledger public.ledgers;
  reopened_ledger public.ledgers;
begin
  if nullif(trim(reopen_reason), '') is null then
    raise exception '重新打开定稿账本必须填写原因';
  end if;
  if target_status in ('finalized', 'locked') then
    raise exception '重新打开后的账本状态无效';
  end if;

  select * into existing_ledger
  from public.ledgers
  where workspace_id = target_workspace and id = target_ledger
  for update;

  if not found then
    raise exception '找不到要重新打开的月度账本';
  end if;
  if existing_ledger.status = 'locked' then
    raise exception '已锁定账本不能重新打开';
  end if;
  if existing_ledger.status <> 'finalized' then
    raise exception '只有已定稿账本可以走受控重开路径';
  end if;

  perform set_config('shopeers.reopen_workspace_id', target_workspace, true);
  perform set_config('shopeers.reopen_ledger_id', target_ledger, true);
  delete from public.profit_lines
  where workspace_id = target_workspace and ledger_id = target_ledger;
  perform set_config('shopeers.reopen_workspace_id', '', true);
  perform set_config('shopeers.reopen_ledger_id', '', true);

  update public.ledgers
  set status = target_status,
      summary = coalesce(target_summary, '{}'::jsonb),
      cost_summary = coalesce(target_cost_summary, '{}'::jsonb),
      profit_summary = null,
      formula_version = null,
      finalized_at = null,
      finalized_by = null,
      updated_at = target_updated_at
  where workspace_id = target_workspace and id = target_ledger
  returning * into reopened_ledger;

  return reopened_ledger;
exception when others then
  perform set_config('shopeers.reopen_workspace_id', '', true);
  perform set_config('shopeers.reopen_ledger_id', '', true);
  raise;
end;
$$;

revoke all on function public.reopen_ledger_for_cost_recalculation(text, text, text, jsonb, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reopen_ledger_for_cost_recalculation(text, text, text, jsonb, jsonb, timestamptz, text)
  to service_role;

alter table public.erp_cost_inbox enable row level security;
alter table public.erp_cost_inbox force row level security;

create policy erp_inbox_read on public.erp_cost_inbox for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));
create policy erp_inbox_insert on public.erp_cost_inbox for insert to authenticated
  with check ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])));
create policy erp_inbox_update on public.erp_cost_inbox for update to authenticated
  using ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])))
  with check ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])));

create policy erp_batches_update on public.erp_cost_batches for update to authenticated
  using ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])))
  with check ((select public.has_workspace_role(workspace_id, array['admin','operations','finance'])));
