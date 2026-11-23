-- Stop a trainer from reading an Enthusiast's live tracking when sharing is off.
-- Apply once in the Supabase SQL editor AFTER 20261118233000_profile_service_location.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- No Edge Function changes.
--
-- What changed:
--   private.tracking_can_read(owner) is true when the reader is that person,
--   or is their actively linked trainer and the person is not an Enthusiast
--   unless profiles.share_with_trainer is true.
--   An Enthusiast is membership or intended_plan = 'enthusiast'.
--   Free Clients stay readable by their linked trainer.
--   The SELECT policies on workout_sessions, workout_sets, and
--   personal_exercises use that helper.
--   private.tracking_trainer_of is unchanged, so a frozen shared dashboard
--   still opens after the Enthusiast turns sharing off.
--   Insert and update policies are unchanged.
--
-- Safe to run again: the column is added only if it is missing, the helper
-- is replaced, and each SELECT policy is dropped before it is recreated.

alter table public.profiles
  add column if not exists share_with_trainer boolean not null default false;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create or replace function private.tracking_can_read(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_owner is not null
    and (
      p_owner = (select auth.uid())
      or (
        (select private.tracking_trainer_of(p_owner))
        and (
          not exists (
            select 1
            from public.profiles p
            where p.id = p_owner
              and (
                p.membership = 'enthusiast'
                or p.intended_plan = 'enthusiast'
              )
          )
          or coalesce(
            (select p.share_with_trainer from public.profiles p where p.id = p_owner),
            false
          )
        )
      )
    );
$$;

revoke all on function private.tracking_can_read(uuid) from public, anon;
grant execute on function private.tracking_can_read(uuid) to authenticated;

drop policy if exists personal_exercises_select on public.personal_exercises;
create policy personal_exercises_select
  on public.personal_exercises
  for select
  to authenticated
  using ((select private.tracking_can_read(user_id)));

drop policy if exists workout_sessions_select on public.workout_sessions;
create policy workout_sessions_select
  on public.workout_sessions
  for select
  to authenticated
  using ((select private.tracking_can_read(client_id)));

drop policy if exists workout_sets_select on public.workout_sets;
create policy workout_sets_select
  on public.workout_sets
  for select
  to authenticated
  using ((select private.tracking_can_read(client_id)));

notify pgrst, 'reload schema';
