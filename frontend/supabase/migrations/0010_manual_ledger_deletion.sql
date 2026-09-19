-- Human-confirmed ledger deletion is allowed for any ledger.
-- ERP evidence is part of the ledger's reusable working data and is removed
-- by the parent-ledger cascade when the operator explicitly deletes the ledger.

create or replace function public.assert_ledger_deletable()
returns trigger language plpgsql security invoker
as $$
begin
  return old;
end;
$$;

-- Child rows are deleted by the parent ledger cascade. Their normal edit guard
-- must not turn a confirmed parent deletion into a false "ledger locked" error.
create or replace function public.assert_ledger_editable()
returns trigger language plpgsql security invoker
as $$
declare
  target_ledger text;
  ledger_status text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  target_ledger := case when tg_op = 'DELETE' then old.ledger_id else new.ledger_id end;
  select l.status into ledger_status from public.ledgers l where l.id = target_ledger;
  if ledger_status in ('finalized', 'locked') then
    raise exception '已定稿或已锁定账本不能修改';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.reject_fact_mutation_except_parent_cascade()
returns trigger language plpgsql security invoker
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception '该事实记录不可修改，只能追加新版本';
  end if;
  if exists (
    select 1 from public.ledgers l
    where l.workspace_id = old.workspace_id and l.id = old.ledger_id
  ) then
    raise exception '事实记录不能单独删除，只能随账本整体删除';
  end if;
  return old;
end;
$$;
