-- Make the cloud ERP formal-cost lifecycle append-only. Authenticated clients
-- can insert a publication, but only the sync service can perform the single
-- published/applied -> voided transition.

alter table public.erp_cost_batches
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text,
  add column if not exists void_reason text;

update public.erp_cost_batches b
set voided_at = coalesce(b.voided_at, i.voided_at),
    voided_by = coalesce(b.voided_by, i.voided_by),
    void_reason = coalesce(b.void_reason, i.void_reason)
from public.erp_cost_inbox i
where b.workspace_id = i.workspace_id
  and b.id = i.applied_batch_id
  and b.status = 'voided'
  and i.status = 'voided';

alter table public.erp_cost_batches
  add constraint erp_cost_batches_void_metadata_check
  check (
    status <> 'voided'
    or (
      voided_at is not null
      and nullif(trim(voided_by), '') is not null
      and nullif(trim(void_reason), '') is not null
    )
  );

alter table public.erp_cost_inbox
  add constraint erp_cost_inbox_applied_metadata_check
  check (status not in ('applied', 'voided') or applied_at is not null),
  add constraint erp_cost_inbox_void_metadata_check
  check (
    status <> 'voided'
    or (
      voided_batch_id = applied_batch_id
      and voided_at is not null
      and nullif(trim(voided_by), '') is not null
      and nullif(trim(void_reason), '') is not null
    )
  ),
  add constraint erp_cost_inbox_one_formal_batch
  unique (workspace_id, applied_batch_id);

create or replace function public.protect_erp_cost_batch_transition()
returns trigger language plpgsql security invoker
as $$
begin
  if current_setting('shopeers.void_batch_id', true) is distinct from old.id
    or old.status <> 'published'
    or new.status <> 'voided' then
    raise exception 'ERP 正式成本批次只能通过受控作废函数一次性转换';
  end if;

  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.ledger_id is distinct from old.ledger_id
    or new.request_id is distinct from old.request_id
    or new.source_name is distinct from old.source_name
    or new.input_hash is distinct from old.input_hash
    or new.currency is distinct from old.currency
    or new.summary is distinct from old.summary
    or new.source_contract is distinct from old.source_contract
    or new.published_by is distinct from old.published_by
    or new.published_at is distinct from old.published_at
    or new.created_at is distinct from old.created_at then
    raise exception 'ERP 正式成本批次身份和证据不可修改';
  end if;

  if new.voided_at is null
    or nullif(trim(new.voided_by), '') is null
    or nullif(trim(new.void_reason), '') is null then
    raise exception 'ERP 正式成本作废必须保留时间、操作者和原因';
  end if;
  return new;
end;
$$;

create or replace function public.protect_erp_cost_inbox_transition()
returns trigger language plpgsql security invoker
as $$
begin
  if current_setting('shopeers.void_inbox_id', true) is distinct from old.id
    or old.status <> 'applied'
    or new.status <> 'voided' then
    raise exception 'ERP 收件生命周期只能通过受控作废函数一次性转换';
  end if;

  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.delivery_id is distinct from old.delivery_id
    or new.batch_id is distinct from old.batch_id
    or new.ledger_id is distinct from old.ledger_id
    or new.request_id is distinct from old.request_id
    or new.received_via is distinct from old.received_via
    or new.sent_at is distinct from old.sent_at
    or new.received_at is distinct from old.received_at
    or new.envelope is distinct from old.envelope
    or new.applied_batch_id is distinct from old.applied_batch_id
    or new.applied_at is distinct from old.applied_at
    or new.rejected_at is distinct from old.rejected_at
    or new.rejected_by is distinct from old.rejected_by then
    raise exception 'ERP 收件批次身份和原始证据不可修改';
  end if;

  if new.voided_batch_id is distinct from old.applied_batch_id
    or new.voided_at is null
    or nullif(trim(new.voided_by), '') is null
    or nullif(trim(new.void_reason), '') is null then
    raise exception 'ERP 收件作废必须关联原正式批次并保留完整元数据';
  end if;
  return new;
end;
$$;

drop trigger if exists erp_cost_batches_controlled_transition on public.erp_cost_batches;
create trigger erp_cost_batches_controlled_transition
before update on public.erp_cost_batches
for each row execute function public.protect_erp_cost_batch_transition();

drop trigger if exists erp_cost_inbox_controlled_transition on public.erp_cost_inbox;
create trigger erp_cost_inbox_controlled_transition
before update on public.erp_cost_inbox
for each row execute function public.protect_erp_cost_inbox_transition();

create or replace function public.void_erp_cost_batch(
  target_workspace text,
  target_batch text,
  target_inbox text,
  target_ledger text,
  target_ledger_status text,
  target_summary jsonb,
  target_cost_summary jsonb,
  target_updated_at timestamptz,
  target_voided_at timestamptz,
  target_voided_by text,
  target_void_reason text,
  allow_finalized_reopen boolean default false
)
returns table(batch_id text, inbox_id text, ledger_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_batch public.erp_cost_batches;
  existing_inbox public.erp_cost_inbox;
  existing_ledger public.ledgers;
  linked_inbox_count integer;
  affected integer;
begin
  if target_voided_at is null
    or nullif(trim(target_voided_by), '') is null
    or nullif(trim(target_void_reason), '') is null then
    raise exception '作废正式成本必须填写时间、操作者和原因';
  end if;
  if target_ledger_status not in ('draft', 'cost_pending', 'approval_pending', 'ready') then
    raise exception '作废后的月度账本状态无效';
  end if;

  select * into existing_batch
  from public.erp_cost_batches
  where workspace_id = target_workspace and id = target_batch
  for update;
  if not found then raise exception '找不到要作废的 ERP 正式成本批次'; end if;
  if existing_batch.status <> 'published' then
    raise exception '只有 published ERP 正式成本批次可以作废';
  end if;
  if existing_batch.ledger_id <> target_ledger then
    raise exception 'ERP 正式成本批次与账本身份不一致';
  end if;

  select * into existing_ledger
  from public.ledgers
  where workspace_id = target_workspace and id = existing_batch.ledger_id
  for update;
  if not found then raise exception '找不到 ERP 正式成本对应的月度账本'; end if;
  if existing_ledger.status = 'locked' then raise exception '已锁定账本不能作废 ERP 正式成本'; end if;
  if existing_ledger.status = 'finalized' and not allow_finalized_reopen then
    raise exception '已定稿账本作废必须在同一事务执行受控重开';
  end if;

  select * into existing_inbox
  from public.erp_cost_inbox
  where workspace_id = target_workspace and id = target_inbox
  for update;
  if not found then raise exception '找不到 ERP 正式成本对应的收件记录'; end if;
  if existing_inbox.status <> 'applied'
    or existing_inbox.applied_batch_id <> existing_batch.id
    or existing_inbox.ledger_id <> existing_batch.ledger_id
    or existing_inbox.voided_batch_id is not null then
    raise exception '只有与正式批次一致的 applied 收件记录可以作废';
  end if;

  select count(*) into linked_inbox_count
  from public.erp_cost_inbox
  where workspace_id = target_workspace and applied_batch_id = existing_batch.id;
  if linked_inbox_count <> 1 then
    raise exception 'ERP 正式成本批次必须且只能关联一个收件记录';
  end if;

  perform set_config('shopeers.void_batch_id', existing_batch.id, true);
  perform set_config('shopeers.void_inbox_id', existing_inbox.id, true);

  update public.erp_cost_batches
  set status = 'voided',
      voided_at = target_voided_at,
      voided_by = trim(target_voided_by),
      void_reason = trim(target_void_reason)
  where workspace_id = target_workspace
    and id = existing_batch.id
    and status = 'published';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'ERP 正式成本批次作废冲突'; end if;

  update public.erp_cost_inbox
  set status = 'voided',
      voided_batch_id = applied_batch_id,
      voided_at = target_voided_at,
      voided_by = trim(target_voided_by),
      void_reason = trim(target_void_reason),
      updated_at = target_updated_at
  where workspace_id = target_workspace
    and id = existing_inbox.id
    and status = 'applied'
    and applied_batch_id = existing_batch.id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'ERP 收件批次作废冲突'; end if;

  if existing_ledger.status <> 'finalized' then
    update public.ledgers
    set status = target_ledger_status,
        summary = coalesce(target_summary, '{}'::jsonb),
        cost_summary = coalesce(target_cost_summary, '{}'::jsonb),
        updated_at = target_updated_at
    where workspace_id = target_workspace and id = existing_ledger.id;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'ERP 作废后的账本更新冲突'; end if;
  end if;

  perform set_config('shopeers.void_batch_id', '', true);
  perform set_config('shopeers.void_inbox_id', '', true);
  return query select existing_batch.id, existing_inbox.id, existing_ledger.status;
exception when others then
  perform set_config('shopeers.void_batch_id', '', true);
  perform set_config('shopeers.void_inbox_id', '', true);
  raise;
end;
$$;

revoke all on function public.void_erp_cost_batch(text, text, text, text, text, jsonb, jsonb, timestamptz, timestamptz, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.void_erp_cost_batch(text, text, text, text, text, jsonb, jsonb, timestamptz, timestamptz, text, text, boolean)
  to service_role;

drop policy if exists erp_batches_write on public.erp_cost_batches;
create policy erp_batches_write on public.erp_cost_batches for insert to authenticated
  with check (
    (select public.has_workspace_role(workspace_id, array['admin','operations','finance']))
    and status = 'published'
    and voided_at is null
    and nullif(trim(voided_by), '') is null
    and nullif(trim(void_reason), '') is null
  );

drop policy if exists erp_inbox_insert on public.erp_cost_inbox;
create policy erp_inbox_insert on public.erp_cost_inbox for insert to authenticated
  with check (
    (select public.has_workspace_role(workspace_id, array['admin','operations','finance']))
    and status = 'applied'
    and applied_batch_id is not null
    and applied_at is not null
    and voided_batch_id is null
    and voided_at is null
    and nullif(trim(voided_by), '') is null
    and nullif(trim(void_reason), '') is null
  );

drop policy if exists erp_inbox_update on public.erp_cost_inbox;
drop policy if exists erp_batches_update on public.erp_cost_batches;

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
  ) or exists (
    select 1
    from public.erp_cost_inbox i
    where i.workspace_id = old.workspace_id
      and i.ledger_id = old.id
      and i.status in ('applied', 'voided')
  ) then
    raise exception '存在已发布或已作废 ERP 正式成本生命周期的账本不能物理删除';
  end if;
  return old;
end;
$$;
