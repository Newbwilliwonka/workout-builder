-- Trainers schedule their own program calendar.
-- Apply once in the Supabase SQL editor AFTER 20261111223000_program_times.sql:
--   Dashboard → SQL → New query → paste this file → Run.
--
-- This file was not applied to the live project. Do not run it there from
-- the app. Until it is applied, a trainer's own calendar stays on the device.
--
-- Who can read a calendar does not change. program_can_read already includes
-- the signed-in user's own rows, so a trainer can read their own entries.
--
-- Who can write changes in one way: a Trainer or Master Trainer can create,
-- update, and delete rows they own. Client calendars stay as they are.
-- An Enthusiast still edits only their own. A Free Client still cannot write.
-- A trainer still cannot write a calendar they are not linked to, and still
-- cannot write a linked Enthusiast's calendar while sharing is off.
--
-- The presence column already exists (solo or trainer, default solo) from
-- 20261111180000_programs.sql. This file does not add a column. A row with
-- no designation is stored as solo, which is how the calendar draws it.
--
-- Safe to run again: the helper is replaced in place. Policies already call
-- program_can_write, so they keep the same shape.

create or replace function public.program_can_write(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_owner is not null
    and (
      (
        p_owner = auth.uid()
        and (
          public.share_is_enthusiast(auth.uid())
          or public.program_is_trainer(auth.uid())
        )
      )
      or (
        p_owner <> auth.uid()
        and public.program_is_trainer(auth.uid())
        and public.program_linked(auth.uid(), p_owner)
        and (
          not public.share_is_enthusiast(p_owner)
          or coalesce((select share_with_trainer from public.profiles where id = p_owner), false)
        )
      )
    );
$$;

revoke all on function public.program_can_write(uuid) from public, anon;
grant execute on function public.program_can_write(uuid) to authenticated;
