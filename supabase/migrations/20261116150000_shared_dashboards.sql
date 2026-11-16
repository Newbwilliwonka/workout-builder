-- Shared tracking dashboards. A trainer freezes the cards they arranged
-- and sends that copy to a connected client.
-- Apply once in the Supabase SQL editor AFTER 20261115180000_workout_tracking.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Until it is applied, Tracking still opens. Sharing says it is not available
-- yet, and a client simply has no shared dashboards.
--
-- What it stores:
--   shared_dashboards
--     One frozen copy of the cards a trainer chose to share. The numbers are
--     the values at the moment of sharing. Later workouts do not change the
--     row. as_of and trainer_name are the "As of <date> from <name>" stamp.
--     viewed_at stays empty until that client opens it.
--
-- Who can see a row (row level security):
--   A Trainer or Master Trainer can insert a row only for a client they are
--   connected to right now, and only as themselves. They can read a row they
--   shared only while that connection is still open.
--   The client can read their own rows and can set viewed_at once. They
--   cannot change the cards, the date, or the trainer name.
--   Nobody else can read or write the row. A signed-in person cannot delete
--   one. Removing an account deletes that person's sessions, then their sets,
--   then their typed-in exercises, then these shared rows (as client or as
--   trainer), the same order the tracking cleanup already uses.
--
-- A linked trainer can already read a connected client's workout sessions,
-- sets, and typed-in exercises (workout tracking) and their program calendar
-- when the existing program rules allow it. This file does not widen that.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create table if not exists public.shared_dashboards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  trainer_name text not null,
  as_of date not null,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  viewed_at timestamptz,
  constraint shared_dashboards_name_len check (char_length(btrim(trainer_name)) between 1 and 80),
  constraint shared_dashboards_cards_array check (
    jsonb_typeof(cards) = 'array'
    and jsonb_array_length(cards) between 1 and 6
  )
);

create index if not exists shared_dashboards_client_created_idx
  on public.shared_dashboards (client_id, created_at desc);

alter table public.shared_dashboards enable row level security;

revoke all on public.shared_dashboards from public, anon, authenticated;
grant select, insert, update on public.shared_dashboards to authenticated;

-- Inserts are trainers only, and only for a client they are linked to.
-- Updates only let that client mark the row opened, once.
create or replace function private.shared_dashboard_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  seen text[] := '{}';
  kind text;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A shared dashboard is kept.';
  end if;

  if tg_op = 'INSERT' then
    if new.trainer_id is distinct from auth.uid() then
      raise exception 'You share a dashboard as yourself.';
    end if;
    if not private.tracking_trainer_of(new.client_id) then
      raise exception 'You can share a dashboard only with a connected client.';
    end if;
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and membership in ('trainer', 'master_trainer')
    ) then
      raise exception 'Only a trainer can share a dashboard.';
    end if;
    if new.viewed_at is not null then
      raise exception 'A new dashboard has not been opened.';
    end if;
    new.trainer_name := btrim(coalesce(new.trainer_name, ''));
    if char_length(new.trainer_name) < 1 or char_length(new.trainer_name) > 80 then
      raise exception 'Enter the trainer name.';
    end if;
    if new.as_of is null then
      raise exception 'A dashboard needs a date.';
    end if;
    if new.cards is null
       or jsonb_typeof(new.cards) is distinct from 'array'
       or jsonb_array_length(new.cards) < 1
       or jsonb_array_length(new.cards) > 6
       or octet_length(new.cards::text) > 200000 then
      raise exception 'Choose the cards to share.';
    end if;
    for item in select value from jsonb_array_elements(new.cards) loop
      kind := item->>'type';
      if kind is null or kind not in ('plan', 'workouts', 'volume', 'records', 'calendar', 'pass') then
        raise exception 'Choose the cards to share.';
      end if;
      if kind = any (seen) then
        raise exception 'Each card is shared once.';
      end if;
      seen := seen || kind;
    end loop;
    new.created_at := now();
    return new;
  end if;

  if auth.uid() is distinct from old.client_id then
    raise exception 'Only the client can open this dashboard.';
  end if;
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.trainer_id is distinct from old.trainer_id
     or new.trainer_name is distinct from old.trainer_name
     or new.as_of is distinct from old.as_of
     or new.cards is distinct from old.cards
     or new.created_at is distinct from old.created_at then
    raise exception 'A shared dashboard cannot be changed.';
  end if;
  if old.viewed_at is not null then
    raise exception 'This dashboard was already opened.';
  end if;
  if new.viewed_at is null then
    raise exception 'Opening a dashboard marks it viewed.';
  end if;
  return new;
end;
$$;

revoke all on function private.shared_dashboard_guard() from public, anon, authenticated;

drop trigger if exists shared_dashboards_guard on public.shared_dashboards;
create trigger shared_dashboards_guard
  before insert or update or delete on public.shared_dashboards
  for each row execute function private.shared_dashboard_guard();

-- Same cleanup as tracking, then the shared copies. Sessions go first so
-- their sets go with them, sets go before the typed-in exercises they point
-- at, and shared rows go after that. This runs only from the profile delete.
create or replace function public.tracking_clear_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema is distinct from 'public'
     or tg_table_name is distinct from 'profiles'
     or tg_op is distinct from 'DELETE' then
    raise exception 'Account history is removed only when the account is removed.';
  end if;
  delete from public.workout_sessions where client_id = old.id;
  delete from public.workout_sets where client_id = old.id;
  delete from public.personal_exercises where user_id = old.id;
  delete from public.shared_dashboards
    where client_id = old.id or trainer_id = old.id;
  return old;
end;
$$;

drop policy if exists shared_dashboards_select on public.shared_dashboards;
create policy shared_dashboards_select
  on public.shared_dashboards
  for select
  to authenticated
  using (
    client_id = (select auth.uid())
    or (
      trainer_id = (select auth.uid())
      and (select private.tracking_trainer_of(client_id))
    )
  );

drop policy if exists shared_dashboards_insert on public.shared_dashboards;
create policy shared_dashboards_insert
  on public.shared_dashboards
  for insert
  to authenticated
  with check (
    trainer_id = (select auth.uid())
    and (select private.tracking_trainer_of(client_id))
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
        and membership in ('trainer', 'master_trainer')
    )
  );

drop policy if exists shared_dashboards_update on public.shared_dashboards;
create policy shared_dashboards_update
  on public.shared_dashboards
  for update
  to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));
