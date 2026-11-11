-- Program calendar: workouts placed on a day.
-- Apply once in the Supabase SQL editor AFTER 20261111160000_share_own.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not put a service-role key in the app. The site only reads and writes
-- program_entries under the policies below.
--
-- This file was not applied to the live project from the app. Until it is
-- applied, the calendar still saves on the device and says nothing was
-- uploaded. Messages, invites, sent copies, and sharing are unchanged.
--
-- Who can write a calendar:
--   An Enthusiast can create and edit their own.
--   A Free Client can read their own and cannot move or schedule.
--   A Trainer or Master Trainer can read and edit a linked Free Client's calendar.
--   A Trainer or Master Trainer can read and edit a linked Enthusiast's calendar
--   only while that Enthusiast's share_with_trainer flag is on.
--   Sharing off, a missing link, or an ended link blocks the trainer.
--   An Enthusiast cannot write someone else's calendar, and never gains Send.
--
-- Safe to run again: the table is created only if missing, functions are
-- replaced, and policies are dropped before they are recreated.

create table if not exists public.program_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id),
  local_id text not null,
  workout_local_id text not null,
  workout_name text not null default 'Workout',
  items jsonb not null default '[]'::jsonb,
  day date not null,
  presence text not null default 'solo',
  updated_at timestamptz not null default now(),
  constraint program_entries_local_len check (char_length(local_id) between 1 and 80),
  constraint program_entries_workout_len check (char_length(workout_local_id) between 1 and 80),
  constraint program_entries_name_len check (char_length(workout_name) between 1 and 120),
  constraint program_entries_items_array check (jsonb_typeof(items) = 'array'),
  constraint program_entries_presence check (presence in ('trainer', 'solo')),
  constraint program_entries_owner_local unique (owner_id, local_id)
);

create index if not exists program_entries_owner_day_idx
  on public.program_entries (owner_id, day);

alter table public.program_entries enable row level security;

revoke all on public.program_entries from public, anon, authenticated;
grant select, insert, update, delete on public.program_entries to authenticated;

-- Trainer and Master Trainer are the same capability. Membership wins over a
-- saved plan, matching invites.
create or replace function public.program_is_trainer(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_id is not null
    and exists (
      select 1 from public.profiles
      where id = p_id
        and (
          membership in ('trainer', 'master_trainer')
          or (
            membership not in ('trainer', 'master_trainer', 'enthusiast', 'free_client')
            and intended_plan in ('trainer', 'master_trainer')
          )
        )
    );
$$;

create or replace function public.program_linked(p_trainer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_trainer is not null
    and p_owner is not null
    and exists (
      select 1 from public.trainer_clients
      where trainer_id = p_trainer
        and client_id = p_owner
        and ended_at is null
    );
$$;

-- Read: your own calendar, or a linked client's calendar when you are a
-- trainer. An Enthusiast's calendar is included only while they share.
create or replace function public.program_can_read(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_owner is not null
    and (
      p_owner = auth.uid()
      or (
        public.program_is_trainer(auth.uid())
        and public.program_linked(auth.uid(), p_owner)
        and (
          not public.share_is_enthusiast(p_owner)
          or coalesce((select share_with_trainer from public.profiles where id = p_owner), false)
        )
      )
    );
$$;

-- Write: an Enthusiast edits their own calendar. A trainer edits a linked
-- Free Client's calendar, or a linked Enthusiast's calendar while sharing is on.
-- A Free Client cannot write. A trainer cannot write their own row here.
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
        and public.share_is_enthusiast(auth.uid())
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

create or replace function public.program_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.program_can_write(new.owner_id) then
      raise exception 'You cannot schedule on this calendar.';
    end if;
    new.author_id := auth.uid();
    new.updated_at := now();
    if new.presence is null or new.presence not in ('trainer', 'solo') then
      new.presence := 'solo';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not public.program_can_write(old.owner_id) or not public.program_can_write(new.owner_id) then
      raise exception 'You cannot move workouts on this calendar.';
    end if;
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.local_id is distinct from old.local_id then
      raise exception 'That calendar entry cannot be reassigned.';
    end if;
    new.author_id := auth.uid();
    new.updated_at := now();
    if new.presence is null or new.presence not in ('trainer', 'solo') then
      new.presence := old.presence;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not public.program_can_write(old.owner_id) then
      raise exception 'You cannot remove workouts from this calendar.';
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists program_entries_guard on public.program_entries;
create trigger program_entries_guard
  before insert or update or delete on public.program_entries
  for each row execute function public.program_entries_guard();

drop policy if exists program_entries_select on public.program_entries;
create policy program_entries_select
  on public.program_entries
  for select
  to authenticated
  using ((select public.program_can_read(owner_id)));

drop policy if exists program_entries_insert on public.program_entries;
create policy program_entries_insert
  on public.program_entries
  for insert
  to authenticated
  with check ((select public.program_can_write(owner_id)));

drop policy if exists program_entries_update on public.program_entries;
create policy program_entries_update
  on public.program_entries
  for update
  to authenticated
  using ((select public.program_can_write(owner_id)))
  with check ((select public.program_can_write(owner_id)));

drop policy if exists program_entries_delete on public.program_entries;
create policy program_entries_delete
  on public.program_entries
  for delete
  to authenticated
  using ((select public.program_can_write(owner_id)));
