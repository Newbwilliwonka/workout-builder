-- Private "Add to Google Calendar" link, one per person.
-- Apply once in the Supabase SQL editor AFTER 20261112120000_trainer_own_program.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Then deploy the Edge Function supabase/functions/calendar-feed
-- with JWT verification off. Do not do either step from the app.
-- This file was not applied to the live project.
--
-- What a link contains:
--   Every person gets their own program calendar.
--   A Trainer or Master Trainer also gets client workouts marked
--   Trainer present, for clients they are linked to. An Enthusiast's
--   workouts are included only while share_with_trainer is on.
--   Solo client workouts are not included.
--   A client event title is the workout name, then the client's display
--   name. If the profile has no display name, the part of the email
--   before the @ is used.
--
-- The token is a secret. The browser can read and replace only the
-- signed-in person's row. The feed lookup is not granted to the
-- publishable key. The Edge Function calls it with the service role
-- and passes the token, never another person's id.
--
-- Safe to run again: the table is created only if missing, the display
-- name column is added only if missing, functions are replaced, and
-- policies are dropped before they are recreated.

alter table public.profiles
  add column if not exists display_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_display_name_len'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_display_name_len
      check (display_name is null or char_length(btrim(display_name)) between 1 and 80);
  end if;
end $$;

create table if not exists public.calendar_feeds (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null,
  time_zone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_feeds_token_format check (token ~ '^[0-9a-f]{64}$'),
  constraint calendar_feeds_token_unique unique (token),
  constraint calendar_feeds_zone_format check (time_zone ~ '^[A-Za-z0-9_+-]{1,64}(/[A-Za-z0-9_+-]{1,64}){0,3}$')
);

alter table public.calendar_feeds enable row level security;

revoke all on public.calendar_feeds from public, anon, authenticated;
grant select, insert, update on public.calendar_feeds to authenticated;

create or replace function public.calendar_feeds_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.user_id is distinct from auth.uid() then
      raise exception 'You cannot create a calendar link for someone else.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'That calendar link cannot be reassigned.';
    end if;
    if auth.uid() is not null and old.user_id is distinct from auth.uid() then
      raise exception 'You cannot change someone else''s calendar link.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists calendar_feeds_guard on public.calendar_feeds;
create trigger calendar_feeds_guard
  before insert or update on public.calendar_feeds
  for each row execute function public.calendar_feeds_guard();

drop policy if exists calendar_feeds_select on public.calendar_feeds;
create policy calendar_feeds_select
  on public.calendar_feeds
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists calendar_feeds_insert on public.calendar_feeds;
create policy calendar_feeds_insert
  on public.calendar_feeds
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists calendar_feeds_update on public.calendar_feeds;
create policy calendar_feeds_update
  on public.calendar_feeds
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- One token, one calendar. Returns null when the token is missing or
-- not a real feed token. Titles for client workouts are finished here
-- so the Edge Function cannot widen who is included.
drop function if exists public.calendar_feed_for_token(text);

create or replace function public.calendar_feed_for_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  feed public.calendar_feeds;
  v_user uuid;
  v_zone text;
  v_trainer boolean;
  events jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into feed
  from public.calendar_feeds
  where token = p_token;

  if not found then
    return null;
  end if;

  v_user := feed.user_id;
  v_zone := feed.time_zone;
  v_trainer := public.program_is_trainer(v_user);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'day', s.day,
      'start', s.start_at,
      'end', s.end_at,
      'updated', s.updated
    )
    order by s.day, s.start_at nulls last, s.id
  ), '[]'::jsonb)
  into events
  from (
    select
      e.id::text as id,
      e.workout_name as title,
      to_char(e.day, 'YYYY-MM-DD') as day,
      to_char(e.starts_at, 'HH24:MI') as start_at,
      to_char(e.ends_at, 'HH24:MI') as end_at,
      to_char(e.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated
    from public.program_entries e
    where e.owner_id = v_user

    union all

    select
      e.id::text,
      e.workout_name || ' ' || chr(8211) || ' ' || coalesce(
        nullif(btrim(c.display_name), ''),
        nullif(split_part(coalesce(c.email, ''), '@', 1), ''),
        'Client'
      ),
      to_char(e.day, 'YYYY-MM-DD'),
      to_char(e.starts_at, 'HH24:MI'),
      to_char(e.ends_at, 'HH24:MI'),
      to_char(e.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    from public.program_entries e
    join public.profiles c on c.id = e.owner_id
    where v_trainer
      and e.owner_id <> v_user
      and e.presence = 'trainer'
      and public.program_linked(v_user, e.owner_id)
      and (
        not public.share_is_enthusiast(e.owner_id)
        or coalesce(c.share_with_trainer, false)
      )
  ) s;

  return jsonb_build_object(
    'timezone', v_zone,
    'events', events
  );
end;
$$;

revoke all on function public.calendar_feeds_guard() from public, anon;
revoke all on function public.calendar_feed_for_token(text) from public, anon, authenticated;

grant execute on function public.calendar_feeds_guard() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.calendar_feed_for_token(text) to service_role;
  end if;
end $$;
