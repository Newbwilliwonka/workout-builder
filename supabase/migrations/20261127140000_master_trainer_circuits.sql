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

-- Saving a circuit still goes through two older trainer-plan checks.
-- circuits_guard refuses an insert unless program_is_trainer.
-- circuit_save_run refuses unless membership is trainer or master trainer.
-- An admin is not required to be on either plan. Both checks become
-- private.can_build_circuits(), the same rule as the insert policy above.
do $align_circuits$
declare
  guard_def text := pg_get_functiondef('public.circuits_guard()'::regprocedure);
  save_def text := pg_get_functiondef('public.circuit_save_run(jsonb)'::regprocedure);
  guard_old text := $guard$if not public.program_is_trainer(auth.uid()) then
        raise exception 'Only a trainer can save a circuit.';$guard$;
  guard_new text := $guard$if not private.can_build_circuits() then
        raise exception 'Group circuits are part of Master Trainer.';$guard$;
  save_old text := $save$if me.membership not in ('trainer', 'master_trainer') then
    raise exception 'Only a trainer can save a circuit.' using errcode = '42501';$save$;
  save_new text := $save$if not private.can_build_circuits() then
    raise exception 'Group circuits are part of Master Trainer.' using errcode = '42501';$save$;
begin
  if position(guard_old in guard_def) > 0 then
    guard_def := replace(guard_def, guard_old, guard_new);
  elsif position('if not private.can_build_circuits()' in guard_def) = 0 then
    raise exception 'circuits_guard is missing the Master Trainer check';
  end if;
  if position('program_is_trainer' in guard_def) > 0 then
    raise exception 'circuits_guard still calls program_is_trainer';
  end if;
  execute guard_def;

  if position(save_old in save_def) > 0 then
    save_def := replace(save_def, save_old, save_new);
  elsif position('if not private.can_build_circuits()' in save_def) = 0 then
    raise exception 'circuit_save_run is missing the Master Trainer check';
  end if;
  if position('membership not in' in save_def) > 0 then
    raise exception 'circuit_save_run still requires a trainer plan';
  end if;
  execute save_def;
end
$align_circuits$;

revoke all on function public.circuit_save_run(jsonb) from public, anon;
grant execute on function public.circuit_save_run(jsonb) to authenticated;
