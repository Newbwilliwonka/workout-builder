-- An Enthusiast can let their linked trainer view the Enthusiast's own
-- workouts and tracking. Apply once in the Supabase SQL editor AFTER
-- 20261111140000_workout_copies.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not put a service-role key in the app. The site only calls the functions
-- below and reads own_workouts / own_sessions under the policies.
--
-- This file does not change messages, sent workout copies, or the player.
-- It was not applied to the live project from the app. Until it is applied,
-- the sharing screens say "Not available yet" and the rest of the site keeps
-- working. Redeeming an invite still works if this file has not been applied.
--
-- A linked Enthusiast counts as a client, the same as before. Free Clients
-- are not part of this option: the trainer cannot read their rows here even
-- if the flag is on. The trainer can read an Enthusiast's own workouts and
-- logged sessions only while the link is active and share_with_trainer is
-- on. The trainer cannot insert, update, or delete those rows. Copies a
-- trainer sent live in workout_copies and are not stored here.
--
-- Safe to run again: the column and tables are created only if missing,
-- functions are replaced, and policies are dropped before they are recreated.

alter table public.profiles
  add column if not exists share_with_trainer boolean not null default false;

create table if not exists public.own_workouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint own_workouts_name_len check (char_length(name) between 1 and 120),
  constraint own_workouts_local_len check (char_length(local_id) between 1 and 80),
  constraint own_workouts_items_array check (jsonb_typeof(items) = 'array'),
  constraint own_workouts_owner_local unique (owner_id, local_id)
);

create table if not exists public.own_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  workout_id text,
  workout_name text,
  started_at timestamptz,
  ended_at timestamptz,
  results jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint own_sessions_local_len check (char_length(local_id) between 1 and 80),
  constraint own_sessions_results_array check (jsonb_typeof(results) = 'array'),
  constraint own_sessions_owner_local unique (owner_id, local_id)
);

create index if not exists own_workouts_owner_idx
  on public.own_workouts (owner_id, updated_at desc);

create index if not exists own_sessions_owner_idx
  on public.own_sessions (owner_id, ended_at desc);

alter table public.own_workouts enable row level security;
alter table public.own_sessions enable row level security;

revoke all on public.own_workouts from public, anon, authenticated;
revoke all on public.own_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.own_workouts to authenticated;
grant select, insert, update, delete on public.own_sessions to authenticated;

-- The signed-in person, when they are an Enthusiast (paid or still the saved plan).
create or replace function public.share_is_enthusiast(p_id uuid)
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
        and (membership = 'enthusiast' or intended_plan = 'enthusiast')
    );
$$;

-- True when the signed-in trainer may read this Enthusiast's own rows.
-- Security definer so the check can see the link and the flag, which the
-- trainer cannot read directly. It returns only a boolean.
create or replace function public.share_can_read(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_owner is not null
    and p_owner <> auth.uid()
    and public.share_is_enthusiast(p_owner)
    and coalesce((select share_with_trainer from public.profiles where id = p_owner), false)
    and exists (
      select 1 from public.trainer_clients
      where trainer_id = auth.uid()
        and client_id = p_owner
        and ended_at is null
    );
$$;

-- Blocks a trainer (or anyone else) from writing another person's rows,
-- even if a policy is later widened. Owners write only their own rows.
create or replace function public.own_share_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.owner_id is distinct from auth.uid() then
      raise exception 'A trainer can only view these workouts.';
    end if;
    return old;
  end if;
  if new.owner_id is distinct from auth.uid() then
    raise exception 'A trainer can only view these workouts.';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.local_id is distinct from old.local_id then
      raise exception 'That workout cannot be reassigned.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists own_workouts_guard on public.own_workouts;
create trigger own_workouts_guard
  before insert or update or delete on public.own_workouts
  for each row execute function public.own_share_guard();

drop trigger if exists own_sessions_guard on public.own_sessions;
create trigger own_sessions_guard
  before insert or update or delete on public.own_sessions
  for each row execute function public.own_share_guard();

drop policy if exists own_workouts_select on public.own_workouts;
create policy own_workouts_select
  on public.own_workouts
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (select public.share_can_read(owner_id))
  );

drop policy if exists own_workouts_insert on public.own_workouts;
create policy own_workouts_insert
  on public.own_workouts
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.share_is_enthusiast((select auth.uid())))
  );

drop policy if exists own_workouts_update on public.own_workouts;
create policy own_workouts_update
  on public.own_workouts
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (select public.share_is_enthusiast((select auth.uid())))
  );

drop policy if exists own_workouts_delete on public.own_workouts;
create policy own_workouts_delete
  on public.own_workouts
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists own_sessions_select on public.own_sessions;
create policy own_sessions_select
  on public.own_sessions
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (select public.share_can_read(owner_id))
  );

drop policy if exists own_sessions_insert on public.own_sessions;
create policy own_sessions_insert
  on public.own_sessions
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.share_is_enthusiast((select auth.uid())))
  );

drop policy if exists own_sessions_update on public.own_sessions;
create policy own_sessions_update
  on public.own_sessions
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (select public.share_is_enthusiast((select auth.uid())))
  );

drop policy if exists own_sessions_delete on public.own_sessions;
create policy own_sessions_delete
  on public.own_sessions
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

create or replace function public.share_time(raw text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
begin
  if raw is null or btrim(raw) = '' then return null; end if;
  if btrim(raw) ~ '^[0-9]+(\.[0-9]+)?$' then
    return to_timestamp(btrim(raw)::double precision / 1000.0);
  end if;
  begin
    return btrim(raw)::timestamptz;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public.share_setting()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'on', me.share_with_trainer,
    'enthusiast', public.share_is_enthusiast(uid),
    'linked', exists (
      select 1 from public.trainer_clients
      where client_id = uid and ended_at is null
    )
  );
end;
$$;

create or replace function public.share_set(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  linked boolean;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  if not public.share_is_enthusiast(uid) then
    raise exception 'Only an Enthusiast can share workouts and tracking.';
  end if;
  update public.profiles set share_with_trainer = p_on where id = uid;
  select exists (
    select 1 from public.trainer_clients
    where client_id = uid and ended_at is null
  ) into linked;
  return jsonb_build_object(
    'on', p_on,
    'enthusiast', true,
    'linked', linked
  );
end;
$$;

-- Replaces the signed-in Enthusiast's own rows in one transaction.
-- An empty array means they currently have none. A null payload is rejected
-- so a failed read on the device cannot wipe the stored copy.
create or replace function public.share_push(p_workouts jsonb, p_sessions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  local text;
  wname text;
  ids text[] := '{}';
  session_ids text[] := '{}';
  results jsonb;
  workout_count int := 0;
  session_count int := 0;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not public.share_is_enthusiast(uid) then
    raise exception 'Only an Enthusiast can share workouts and tracking.';
  end if;
  if jsonb_typeof(p_workouts) is distinct from 'array'
     or jsonb_typeof(p_sessions) is distinct from 'array' then
    raise exception 'Could not read workouts to share.';
  end if;
  if jsonb_array_length(p_workouts) > 40
     or jsonb_array_length(p_sessions) > 60
     or octet_length(p_workouts::text) > 800000
     or octet_length(p_sessions::text) > 800000 then
    raise exception 'Could not share that much tracking.';
  end if;

  for item in select value from jsonb_array_elements(p_workouts) loop
    local := nullif(btrim(coalesce(item->>'localId', '')), '');
    wname := btrim(coalesce(item->>'name', ''));
    if local is null or char_length(local) > 80 or wname = '' or char_length(wname) > 120 then
      raise exception 'Could not share a workout.';
    end if;
    if jsonb_typeof(item->'items') is distinct from 'array'
       or jsonb_array_length(item->'items') > 200 then
      raise exception 'Could not share a workout.';
    end if;
    if local = any (ids) then continue; end if;
    ids := ids || local;
    insert into public.own_workouts (owner_id, local_id, name, items, updated_at)
    values (uid, local, wname, item->'items', now())
    on conflict (owner_id, local_id) do update
      set name = excluded.name,
          items = excluded.items,
          updated_at = now();
    workout_count := workout_count + 1;
  end loop;
  delete from public.own_workouts
    where owner_id = uid
      and not (local_id = any (ids));

  for item in select value from jsonb_array_elements(p_sessions) loop
    local := nullif(btrim(coalesce(item->>'localId', '')), '');
    if local is null or char_length(local) > 80 then
      raise exception 'Could not share a session.';
    end if;
    if local = any (session_ids) then continue; end if;
    results := case
      when jsonb_typeof(item->'results') = 'array' then item->'results'
      else '[]'::jsonb
    end;
    if jsonb_array_length(results) > 400 or octet_length(results::text) > 400000 then
      raise exception 'Could not share a session.';
    end if;
    session_ids := session_ids || local;
    wname := btrim(coalesce(item->>'workoutName', ''));
    if char_length(wname) > 120 then wname := left(wname, 120); end if;
    insert into public.own_sessions (
      owner_id, local_id, workout_id, workout_name, started_at, ended_at, results, updated_at
    ) values (
      uid,
      local,
      nullif(left(btrim(coalesce(item->>'workoutId', '')), 80), ''),
      nullif(wname, ''),
      public.share_time(item->>'startedAt'),
      public.share_time(item->>'endedAt'),
      results,
      now()
    )
    on conflict (owner_id, local_id) do update
      set workout_id = excluded.workout_id,
          workout_name = excluded.workout_name,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          results = excluded.results,
          updated_at = now();
    session_count := session_count + 1;
  end loop;
  delete from public.own_sessions
    where owner_id = uid
      and not (local_id = any (session_ids));

  return jsonb_build_object('ok', true, 'workouts', workout_count, 'sessions', session_count);
end;
$$;

-- Who the client is, and whether sharing is on. No workout or tracking rows.
create or replace function public.share_status(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  client public.profiles;
  enthusiast boolean;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found or public.invite_role(me) is null then
    raise exception 'Only a trainer can view a client.';
  end if;
  if p_client is null or not exists (
    select 1 from public.trainer_clients
    where trainer_id = uid and client_id = p_client and ended_at is null
  ) then
    raise exception 'There is no connection.';
  end if;
  select * into client from public.profiles where id = p_client;
  if not found then raise exception 'There is no connection.'; end if;
  enthusiast := coalesce(client.membership, '') = 'enthusiast'
    or coalesce(client.intended_plan, '') = 'enthusiast';
  return jsonb_build_object(
    'linked', true,
    'enthusiast', enthusiast,
    'shared', enthusiast and client.share_with_trainer,
    'email', client.email,
    'plan', case when enthusiast then 'Enthusiast' else 'Free Client' end
  );
end;
$$;

-- Redeem keeps its previous behavior. An Enthusiast stores the sharing choice.
-- Omitting the choice (the previous one-argument call) stores on, which is
-- the pre-checked option. A Free Client's flag is left unchanged.
drop function if exists public.invite_redeem(text);

create or replace function public.invite_redeem(p_code text, p_share boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  inv public.invites;
  trainer public.profiles;
  norm text;
  existing uuid;
  active_clients int;
  cap int;
  enthusiast boolean;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  if public.invite_role(me) is not null then
    raise exception 'A Trainer or Master Trainer cannot join as a client.';
  end if;
  select id into existing from public.trainer_clients
    where client_id = uid and ended_at is null limit 1;
  if existing is not null then
    raise exception 'You are already connected to a trainer. End that connection before using a new invite.';
  end if;
  norm := public.invite_norm(p_code);
  if norm !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'That invite code was not found.';
  end if;
  select * into inv from public.invites where code = norm for update;
  if not found then raise exception 'That invite code was not found.'; end if;
  if inv.used_at is not null then raise exception 'That invite has already been used.'; end if;
  if inv.canceled_at is not null then raise exception 'That invite was canceled.'; end if;
  if inv.expires_at <= now() then raise exception 'That invite has expired.'; end if;
  perform pg_advisory_xact_lock(hashtext(inv.trainer_id::text));
  select * into trainer from public.profiles where id = inv.trainer_id;
  cap := public.invite_cap(public.invite_role(trainer));
  select count(*) into active_clients from public.trainer_clients
    where trainer_id = inv.trainer_id and ended_at is null;
  if active_clients >= cap then
    raise exception 'That trainer has no open client spots.';
  end if;
  enthusiast := coalesce(me.membership, '') = 'enthusiast'
    or coalesce(me.intended_plan, '') = 'enthusiast';
  if not enthusiast and me.membership is distinct from 'free_client' then
    perform set_config('app.invite_redeem', 'on', true);
    update public.profiles set membership = 'free_client' where id = uid;
  end if;
  if enthusiast then
    update public.profiles
      set share_with_trainer = case when p_share is null then true else p_share end
      where id = uid;
  end if;
  update public.invites set used_at = now(), used_by = uid where id = inv.id;
  insert into public.trainer_clients (trainer_id, client_id) values (inv.trainer_id, uid);
  if enthusiast then
    return jsonb_build_object(
      'message', 'You are connected. Your Enthusiast plan is unchanged.',
      'trainer_id', inv.trainer_id
    );
  end if;
  return jsonb_build_object(
    'message', 'You are connected as a Free Client.',
    'trainer_id', inv.trainer_id
  );
end;
$$;

revoke all on function public.share_is_enthusiast(uuid) from public, anon;
revoke all on function public.share_can_read(uuid) from public, anon;
revoke all on function public.own_share_guard() from public, anon;
grant execute on function public.own_share_guard() to authenticated;
revoke all on function public.share_time(text) from public, anon, authenticated;
revoke all on function public.share_setting() from public, anon, authenticated;
revoke all on function public.share_set(boolean) from public, anon, authenticated;
revoke all on function public.share_push(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.share_status(uuid) from public, anon, authenticated;
revoke all on function public.invite_redeem(text, boolean) from public, anon;

-- Policies call these as the signed-in user, so that user needs execute.
grant execute on function public.share_is_enthusiast(uuid) to authenticated;
grant execute on function public.share_can_read(uuid) to authenticated;
grant execute on function public.share_setting() to authenticated;
grant execute on function public.share_set(boolean) to authenticated;
grant execute on function public.share_push(jsonb, jsonb) to authenticated;
grant execute on function public.share_status(uuid) to authenticated;
grant execute on function public.invite_redeem(text, boolean) to authenticated;

notify pgrst, 'reload schema';
