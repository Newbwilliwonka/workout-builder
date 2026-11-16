-- Frozen dashboards a trainer shares with a connected client.
-- Apply once in the Supabase SQL editor AFTER 20261115180000_workout_tracking.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Until it is applied, Tracking still opens. A share says it was not saved.
-- A Free Client sees the empty dashboard page, and the red count stays hidden.
--
-- What it stores:
--   shared_dashboards
--     One row per share. The cards column is the dashboard as it looked at
--     that moment (the numbers already drawn on the cards), not a live query.
--     as_of is the local date on the stamp. trainer_name is copied from the
--     trainer's profile when the row is saved, so a later rename does not
--     change an old share. viewed_at stays empty until that client opens it.
--
-- Who can see a row (row level security):
--   A Trainer or Master Trainer can insert a row only for a client they are
--   connected to right now. They can read a share they created only while
--   that connection is still open. They cannot edit or delete it.
--   The client can read their own shares and can mark one viewed. They cannot
--   change the cards, the date, or the trainer name, and they cannot insert.
--   Nobody else can read the row. Ending the connection hides it from the
--   trainer. The client keeps it.
--
-- Account removal deletes these rows first, then sessions, then sets, then
-- typed-in exercises. That is the same order the tracking cleanup already
-- uses, with the shares removed before the sessions. A removed trainer also
-- drops the shares they sent.

create table if not exists public.shared_dashboards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  trainer_name text not null,
  as_of date not null,
  shared_at timestamptz not null default now(),
  viewed_at timestamptz,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  constraint shared_dashboards_name_len check (char_length(btrim(trainer_name)) between 1 and 80),
  constraint shared_dashboards_cards_object check (jsonb_typeof(cards) = 'object'),
  constraint shared_dashboards_viewed_after check (viewed_at is null or viewed_at >= shared_at),
  constraint shared_dashboards_distinct_pair check (client_id <> trainer_id)
);

create index if not exists shared_dashboards_client_idx
  on public.shared_dashboards (client_id, shared_at desc, id desc);

alter table public.shared_dashboards enable row level security;

revoke all on public.shared_dashboards from public, anon, authenticated;
grant select, insert, update on public.shared_dashboards to authenticated;

-- order is the card list. blocks is the drawn data for those cards.
-- Known cards only, no duplicates, and a size cap so a share cannot grow
-- without limit. The numbers inside a block are not recomputed here.
create or replace function private.shared_dashboard_cards_ok(raw jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  seen text[] := '{}';
  id text;
  n int := 0;
begin
  if raw is null or jsonb_typeof(raw) is distinct from 'object' then
    return false;
  end if;
  if jsonb_typeof(raw->'order') is distinct from 'array' then
    return false;
  end if;
  if jsonb_typeof(raw->'blocks') is distinct from 'object' then
    return false;
  end if;
  if octet_length(raw::text) > 200000 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(raw->'order') loop
    n := n + 1;
    if jsonb_typeof(item) is distinct from 'string' then
      return false;
    end if;
    id := item #>> '{}';
    if id not in ('plan', 'workouts', 'volume', 'records', 'calendar', 'pass') then
      return false;
    end if;
    if id = any (seen) then
      return false;
    end if;
    seen := seen || id;
  end loop;
  return n >= 1 and n <= 6;
end;
$$;

create or replace function private.shared_dashboards_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  role text;
  stamped text;
begin
  if uid is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A shared dashboard is removed only when an account is removed.';
  end if;

  if tg_op = 'INSERT' then
    if new.trainer_id is distinct from uid or new.client_id = uid then
      raise exception 'You share a dashboard with a connected client.';
    end if;
    select p.membership into role from public.profiles p where p.id = uid;
    if role is null or role not in ('trainer', 'master_trainer') then
      raise exception 'Only a trainer can share a dashboard.';
    end if;
    if not private.tracking_trainer_of(new.client_id) then
      raise exception 'There is no connection.';
    end if;
    if not private.shared_dashboard_cards_ok(new.cards) then
      raise exception 'That dashboard cannot be shared.';
    end if;
    if new.as_of is null or new.as_of < (current_date - 1) or new.as_of > (current_date + 1) then
      raise exception 'That dashboard cannot be shared.';
    end if;
    select coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
      'Trainer'
    )
    into stamped
    from public.profiles p
    where p.id = uid;
    if stamped is null or char_length(stamped) > 80 then
      stamped := left(coalesce(stamped, 'Trainer'), 80);
    end if;
    if stamped is null or btrim(stamped) = '' then
      stamped := 'Trainer';
    end if;
    new.trainer_name := stamped;
    new.viewed_at := null;
    new.shared_at := now();
    new.created_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if uid is distinct from old.client_id then
      raise exception 'Only the client can open a shared dashboard.';
    end if;
    if new.id is distinct from old.id
       or new.client_id is distinct from old.client_id
       or new.trainer_id is distinct from old.trainer_id
       or new.trainer_name is distinct from old.trainer_name
       or new.as_of is distinct from old.as_of
       or new.cards is distinct from old.cards
       or new.shared_at is distinct from old.shared_at
       or new.created_at is distinct from old.created_at then
      raise exception 'A shared dashboard cannot be edited.';
    end if;
    if old.viewed_at is not null then
      new.viewed_at := old.viewed_at;
      return new;
    end if;
    if new.viewed_at is null then
      raise exception 'A shared dashboard cannot be edited.';
    end if;
    new.viewed_at := now();
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists shared_dashboards_guard on public.shared_dashboards;
create trigger shared_dashboards_guard
  before insert or update or delete on public.shared_dashboards
  for each row execute function private.shared_dashboards_guard();

-- Same cleanup as workout tracking, with shares removed first. Sessions,
-- then sets, then typed-in exercises stay in that order so the exercise
-- link does not block the account removal.
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
  delete from public.shared_dashboards where client_id = old.id or trainer_id = old.id;
  delete from public.workout_sessions where client_id = old.id;
  delete from public.workout_sets where client_id = old.id;
  delete from public.personal_exercises where user_id = old.id;
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
    and client_id <> (select auth.uid())
    and (select private.tracking_trainer_of(client_id))
  );

drop policy if exists shared_dashboards_update on public.shared_dashboards;
create policy shared_dashboards_update
  on public.shared_dashboards
  for update
  to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

revoke all on function private.shared_dashboard_cards_ok(jsonb) from public, anon, authenticated;
revoke all on function private.shared_dashboards_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
