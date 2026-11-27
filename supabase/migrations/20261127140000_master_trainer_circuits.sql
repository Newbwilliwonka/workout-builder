-- Group circuits are a Master Trainer feature. Admins keep access.
-- A Trainer membership can still open the rest of the trainer tools.

create or replace function private.can_build_circuits()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and membership = 'master_trainer'
      )
      or private.is_admin()
    );
$$;

revoke all on function private.can_build_circuits() from public, anon, authenticated;
grant execute on function private.can_build_circuits() to authenticated;

create or replace function public.circuits_tier_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if (select auth.uid()) is null then
    return new;
  end if;
  if not private.can_build_circuits() then
    raise exception 'Group circuits are part of Master Trainer.';
  end if;
  return new;
end;
$$;

revoke all on function public.circuits_tier_guard() from public, anon;
grant execute on function public.circuits_tier_guard() to authenticated;

drop trigger if exists circuits_tier_guard on public.circuits;
create trigger circuits_tier_guard
  before insert or update on public.circuits
  for each row execute function public.circuits_tier_guard();

drop policy if exists circuits_insert on public.circuits;
create policy circuits_insert
  on public.circuits
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.is_approved((select auth.uid())))
    and private.can_build_circuits()
  );

-- The existing saver still allows any trainer. Keep that body, and refuse
-- the call unless this account can build circuits.
alter function public.circuit_save_run(jsonb) rename to circuit_save_run_trainer;

revoke all on function public.circuit_save_run_trainer(jsonb) from public, anon, authenticated;

create or replace function public.circuit_save_run(p_run jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if not private.can_build_circuits() then
    raise exception 'Group circuits are part of Master Trainer.' using errcode = '42501';
  end if;
  return public.circuit_save_run_trainer(p_run);
end;
$$;

revoke all on function public.circuit_save_run(jsonb) from public, anon;
grant execute on function public.circuit_save_run(jsonb) to authenticated;
