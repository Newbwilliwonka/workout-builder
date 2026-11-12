-- Start and end times on a scheduled workout.
-- Apply once in the Supabase SQL editor AFTER 20261111180000_programs.sql:
--   Dashboard → SQL → New query → paste this file → Run.
--
-- This file was not applied to the live project from the app. Until it is
-- applied, start and end times stay on the device. The calendar itself still
-- saves on the device, and a shared calendar that already exists keeps working.
--
-- Who can read and write a calendar does not change. The policies and helper
-- functions from the programs migration stay as they are.
--
-- Safe to run again: the columns are added only if missing, and the check is
-- created only if missing.

alter table public.program_entries
  add column if not exists starts_at time,
  add column if not exists ends_at time;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'program_entries_time_order'
      and conrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries
      add constraint program_entries_time_order
      check (starts_at is null or ends_at is null or ends_at > starts_at);
  end if;
end $$;
