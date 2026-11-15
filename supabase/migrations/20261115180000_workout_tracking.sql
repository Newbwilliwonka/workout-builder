-- Completed workout sessions, one row per set.
-- Apply once in the Supabase SQL editor AFTER 20261115140000_master_trainer_verification.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Until it is applied, finishing a workout still works and the summary says
-- the session was not saved.
--
-- What it stores:
--   workout_sessions
--     One row for the person who performed the workout (the client), the
--     workout it came from, whether that workout was their own or sent by a
--     trainer, the start and end (with the time zone and the local date),
--     and whether it was completed or ended early. A session can also be
--     in progress, which is the only time a trainer may write sets.
--   workout_sets
--     One row per set. The last attempt replaces that row. A set is never
--     hard-deleted; removed marks it out. Planned values and actual values
--     sit side by side. Weight is kilograms. Time is seconds. The unit the
--     person picked (lb, kg, or bodyweight) is stored for display.
--   personal_exercises
--     A stable id per person for an exercise they typed in. Renaming it
--     updates the name and keeps the id, so older sets stay on the same
--     exercise. A library exercise stores the library id instead.
--     A set may use only that client's personal exercise. Removing the
--     exercise does not remove its sets. Removing the account still does.
--
-- Who can see a row (row level security):
--   The client can read and insert their own sessions and sets, and can
--   mark a set removed. The client cannot hard-delete a session or a set.
--   A trainer linked to that client can read the client's rows. The trainer
--   can insert or update sets only while that session is in progress, and
--   only as the person who logged the attempt. After the session ends, a
--   trainer cannot edit or delete. When the link ends, the client keeps
--   every row and the trainer can no longer read them.
--
-- own_sessions is unchanged. That table is still the shared bundle of a
-- session. This file does not read or write it.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

-- Kilograms. Bodyweight and a missing number are null. Pounds are converted.
create or replace function public.tracking_to_kg(p_value numeric, p_unit text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_unit = 'bodyweight' or p_value is null then null
    when p_value < 0 then null
    when p_unit = 'kg' then p_value
    when p_unit = 'lb' then p_value * 0.45359237
    else null
  end;
$$;

create or replace function public.tracking_num(raw text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  if btrim(raw) !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'Could not save that set.';
  end if;
  return btrim(raw)::numeric;
end;
$$;

-- Lap list as seconds: [{n, lapSec, totalSec}, ...].
create or replace function public.tracking_laps(raw jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  out jsonb := '[]'::jsonb;
  n int := 0;
  lap numeric;
  total numeric;
begin
  if raw is null or jsonb_typeof(raw) = 'null' then
    return null;
  end if;
  if jsonb_typeof(raw) is distinct from 'array' or jsonb_array_length(raw) > 100 then
    raise exception 'Could not save that set.';
  end if;
  for item in select value from jsonb_array_elements(raw) loop
    n := n + 1;
    lap := public.tracking_num(item->>'lapSec');
    total := public.tracking_num(item->>'totalSec');
    if lap is null or total is null then
      raise exception 'Could not save that set.';
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'n', n,
      'lapSec', lap,
      'totalSec', total
    ));
  end loop;
  return out;
end;
$$;

-- Named stopwatch events. result is pass, fail, or absent.
create or replace function public.tracking_events(raw jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  out jsonb := '[]'::jsonb;
  n int := 0;
  lap numeric;
  label text;
  mark text;
begin
  if raw is null or jsonb_typeof(raw) = 'null' then
    return null;
  end if;
  if jsonb_typeof(raw) is distinct from 'array' or jsonb_array_length(raw) > 100 then
    raise exception 'Could not save that set.';
  end if;
  for item in select value from jsonb_array_elements(raw) loop
    n := n + 1;
    lap := public.tracking_num(item->>'lap');
    label := btrim(coalesce(item->>'name', ''));
    mark := lower(btrim(coalesce(item->>'result', '')));
    if lap is null or lap < 1 or lap <> trunc(lap) or label = '' or char_length(label) > 80 then
      raise exception 'Could not save that set.';
    end if;
    if mark = '' then
      mark := null;
    elsif mark not in ('pass', 'fail') then
      raise exception 'Could not save that set.';
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'lap', lap,
      'name', label,
      'result', mark
    ));
  end loop;
  return out;
end;
$$;

-- True when the signed-in trainer is currently linked to this client.
create or replace function private.tracking_trainer_of(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_client is not null
    and p_client <> (select auth.uid())
    and exists (
      select 1
      from public.trainer_clients tc
      where tc.trainer_id = (select auth.uid())
        and tc.client_id = p_client
        and tc.ended_at is null
    );
$$;

create table if not exists public.personal_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stable_key text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_exercises_key_len check (char_length(stable_key) between 1 and 80),
  constraint personal_exercises_key_shape check (stable_key ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint personal_exercises_name_len check (char_length(btrim(name)) between 1 and 200),
  constraint personal_exercises_user_key unique (user_id, stable_key),
  constraint personal_exercises_id_user unique (id, user_id)
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  workout_id text,
  workout_name text,
  origin text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  time_zone text not null,
  local_date date not null,
  status text not null,
  program_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sessions_local_len check (char_length(local_id) between 1 and 80),
  constraint workout_sessions_local_shape check (local_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint workout_sessions_workout_len check (workout_id is null or char_length(workout_id) between 1 and 80),
  constraint workout_sessions_name_len check (workout_name is null or char_length(workout_name) between 1 and 120),
  constraint workout_sessions_origin check (origin in ('own', 'trainer')),
  constraint workout_sessions_zone_len check (char_length(time_zone) between 1 and 64),
  constraint workout_sessions_status check (status in ('in_progress', 'completed', 'ended_early')),
  constraint workout_sessions_program_len check (program_id is null or char_length(program_id) between 1 and 80),
  constraint workout_sessions_open_or_ended check (
    (status = 'in_progress' and ended_at is null)
    or (
      status in ('completed', 'ended_early')
      and ended_at is not null
      and ended_at >= started_at
    )
  ),
  constraint workout_sessions_client_local unique (client_id, local_id)
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  step integer not null,
  library_exercise_id text,
  personal_exercise_id uuid,
  exercise_name text not null,
  mode text not null,
  set_number integer not null,
  group_tag text,
  status text not null,
  removed boolean not null default false,
  logged_by uuid references public.profiles (id) on delete set null,
  logged_by_role text not null,
  display_unit text not null,
  planned_reps numeric,
  planned_reps_min numeric,
  planned_reps_max numeric,
  planned_weight_kg numeric,
  planned_bodyweight boolean not null default false,
  actual_reps numeric,
  actual_weight_kg numeric,
  actual_bodyweight boolean not null default false,
  planned_hold_sec numeric,
  actual_hold_sec numeric,
  planned_work_sec numeric,
  actual_work_sec numeric,
  planned_rest_sec numeric,
  actual_rest_sec numeric,
  planned_rounds numeric,
  actual_rounds numeric,
  planned_total_sec numeric,
  actual_total_sec numeric,
  planned_lap_count integer,
  actual_laps jsonb,
  planned_events jsonb,
  actual_events jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sets_step check (step >= 0),
  constraint workout_sets_number check (set_number >= 1),
  constraint workout_sets_name_len check (char_length(btrim(exercise_name)) between 1 and 200),
  constraint workout_sets_mode check (mode in ('reps', 'intervals', 'timer', 'stopwatch', 'static_hold')),
  constraint workout_sets_status check (status in ('completed', 'skipped')),
  constraint workout_sets_role check (logged_by_role in ('client', 'trainer')),
  constraint workout_sets_unit check (display_unit in ('lb', 'kg', 'bodyweight')),
  constraint workout_sets_group_len check (group_tag is null or char_length(group_tag) between 1 and 80),
  constraint workout_sets_library_len check (
    library_exercise_id is null or library_exercise_id ~ '^[A-Za-z0-9_-]{1,32}$'
  ),
  constraint workout_sets_one_exercise check (
    (library_exercise_id is not null and personal_exercise_id is null)
    or (library_exercise_id is null and personal_exercise_id is not null)
  ),
  constraint workout_sets_personal_owner
    foreign key (personal_exercise_id, client_id)
    references public.personal_exercises (id, user_id),
  constraint workout_sets_planned_bw check (planned_bodyweight = false or planned_weight_kg is null),
  constraint workout_sets_actual_bw check (actual_bodyweight = false or actual_weight_kg is null),
  constraint workout_sets_weight_nonneg check (
    (planned_weight_kg is null or planned_weight_kg >= 0)
    and (actual_weight_kg is null or actual_weight_kg >= 0)
  ),
  constraint workout_sets_time_nonneg check (
    (planned_hold_sec is null or planned_hold_sec >= 0)
    and (actual_hold_sec is null or actual_hold_sec >= 0)
    and (planned_work_sec is null or planned_work_sec >= 0)
    and (actual_work_sec is null or actual_work_sec >= 0)
    and (planned_rest_sec is null or planned_rest_sec >= 0)
    and (actual_rest_sec is null or actual_rest_sec >= 0)
    and (planned_total_sec is null or planned_total_sec >= 0)
    and (actual_total_sec is null or actual_total_sec >= 0)
    and (planned_rounds is null or planned_rounds >= 0)
    and (actual_rounds is null or actual_rounds >= 0)
    and (planned_reps is null or planned_reps >= 0)
    and (actual_reps is null or actual_reps >= 0)
  ),
  constraint workout_sets_laps_array check (actual_laps is null or jsonb_typeof(actual_laps) = 'array'),
  constraint workout_sets_planned_events_array check (planned_events is null or jsonb_typeof(planned_events) = 'array'),
  constraint workout_sets_actual_events_array check (actual_events is null or jsonb_typeof(actual_events) = 'array'),
  constraint workout_sets_session_step unique (session_id, step)
);

create index if not exists personal_exercises_user_idx
  on public.personal_exercises (user_id, stable_key);

create index if not exists workout_sessions_client_date_idx
  on public.workout_sessions (client_id, local_date desc);

create index if not exists workout_sessions_client_ended_idx
  on public.workout_sessions (client_id, ended_at desc);

create index if not exists workout_sets_client_idx
  on public.workout_sets (client_id, session_id);

create or replace function private.tracking_session_status(p_session uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.status
  from public.workout_sessions s
  where s.id = p_session;
$$;

alter table public.personal_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;

revoke all on public.personal_exercises from public, anon, authenticated;
revoke all on public.workout_sessions from public, anon, authenticated;
revoke all on public.workout_sets from public, anon, authenticated;

grant select, insert, update on public.personal_exercises to authenticated;
grant select, insert, update on public.workout_sessions to authenticated;
grant select, insert, update on public.workout_sets to authenticated;

create or replace function private.tracking_personal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Exercise history is kept.';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'That exercise belongs to someone else.';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.stable_key is distinct from old.stable_key then
      raise exception 'That exercise cannot be reassigned.';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.tracking_session_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Sessions are kept.';
  end if;
  if tg_op = 'INSERT' then
    if new.client_id is distinct from auth.uid() then
      raise exception 'A session belongs to the person who performed it.';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.local_id is distinct from old.local_id then
    raise exception 'That session cannot be reassigned.';
  end if;
  if auth.uid() is distinct from old.client_id then
    raise exception 'A trainer cannot change the session.';
  end if;
  if old.status <> 'in_progress' then
    raise exception 'A finished session cannot be changed.';
  end if;
  new.updated_at := now();
  if new.status = 'in_progress' then
    if to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
      raise exception 'End the session to finish it.';
    end if;
    return new;
  end if;
  if new.status not in ('completed', 'ended_early') or new.ended_at is null then
    raise exception 'A finished session needs an end time.';
  end if;
  if new.workout_id is distinct from old.workout_id
     or new.workout_name is distinct from old.workout_name
     or new.origin is distinct from old.origin
     or new.started_at is distinct from old.started_at
     or new.time_zone is distinct from old.time_zone
     or new.local_date is distinct from old.local_date
     or new.program_id is distinct from old.program_id
     or new.created_at is distinct from old.created_at then
    raise exception 'That session cannot be reassigned.';
  end if;
  return new;
end;
$$;

create or replace function private.tracking_set_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  st text;
begin
  if tg_op <> 'DELETE'
     and new.personal_exercise_id is not null
     and not exists (
       select 1
       from public.personal_exercises p
       where p.id = new.personal_exercise_id
         and p.user_id = new.client_id
     ) then
    raise exception 'That exercise belongs to someone else.';
  end if;
  if uid is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Sets are kept. Mark the set removed instead.';
  end if;
  if not exists (
    select 1
    from public.workout_sessions s
    where s.id = new.session_id
      and s.client_id = new.client_id
  ) then
    raise exception 'That set does not belong to this session.';
  end if;
  st := private.tracking_session_status(new.session_id);
  if tg_op = 'INSERT' then
    if new.logged_by is distinct from uid then
      raise exception 'A set records the person who logged it.';
    end if;
    if new.client_id = uid then
      if new.logged_by_role is distinct from 'client' then
        raise exception 'You log your own sets as the client.';
      end if;
    else
      if new.logged_by_role is distinct from 'trainer' then
        raise exception 'A trainer logs a client set as the trainer.';
      end if;
      if not private.tracking_trainer_of(new.client_id) then
        raise exception 'There is no connection.';
      end if;
      if st is distinct from 'in_progress' then
        raise exception 'A trainer can log sets only while the session is in progress.';
      end if;
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.session_id is distinct from old.session_id
     or new.client_id is distinct from old.client_id
     or new.step is distinct from old.step
     or new.library_exercise_id is distinct from old.library_exercise_id
     or new.personal_exercise_id is distinct from old.personal_exercise_id
     or new.mode is distinct from old.mode
     or new.set_number is distinct from old.set_number
     or new.group_tag is distinct from old.group_tag
     or new.created_at is distinct from old.created_at then
    raise exception 'That set cannot be reassigned.';
  end if;
  new.updated_at := now();
  if old.removed then
    raise exception 'A removed set stays removed.';
  end if;
  if new.removed then
    if uid is distinct from old.client_id then
      raise exception 'A trainer cannot remove a set.';
    end if;
    if to_jsonb(new) - 'removed' - 'updated_at' is distinct from to_jsonb(old) - 'removed' - 'updated_at' then
      raise exception 'A finished set can only be marked removed.';
    end if;
    return new;
  end if;
  if st is distinct from 'in_progress' then
    raise exception 'A finished set can only be marked removed.';
  end if;
  if new.logged_by is distinct from uid then
    raise exception 'A set records the person who logged it.';
  end if;
  if uid = old.client_id then
    if new.logged_by_role is distinct from 'client' then
      raise exception 'You log your own sets as the client.';
    end if;
    return new;
  end if;
  if new.logged_by_role is distinct from 'trainer' or not private.tracking_trainer_of(old.client_id) then
    raise exception 'A trainer can log sets only while the session is in progress.';
  end if;
  return new;
end;
$$;

drop trigger if exists personal_exercises_guard on public.personal_exercises;
create trigger personal_exercises_guard
  before insert or update or delete on public.personal_exercises
  for each row execute function private.tracking_personal_guard();

drop trigger if exists workout_sessions_guard on public.workout_sessions;
create trigger workout_sessions_guard
  before insert or update or delete on public.workout_sessions
  for each row execute function private.tracking_session_guard();

drop trigger if exists workout_sets_guard on public.workout_sets;
create trigger workout_sets_guard
  before insert or update or delete on public.workout_sets
  for each row execute function private.tracking_set_guard();

drop policy if exists personal_exercises_select on public.personal_exercises;
create policy personal_exercises_select
  on public.personal_exercises
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.tracking_trainer_of(user_id))
  );

drop policy if exists personal_exercises_insert on public.personal_exercises;
create policy personal_exercises_insert
  on public.personal_exercises
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists personal_exercises_update on public.personal_exercises;
create policy personal_exercises_update
  on public.personal_exercises
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists workout_sessions_select on public.workout_sessions;
create policy workout_sessions_select
  on public.workout_sessions
  for select
  to authenticated
  using (
    client_id = (select auth.uid())
    or (select private.tracking_trainer_of(client_id))
  );

drop policy if exists workout_sessions_insert on public.workout_sessions;
create policy workout_sessions_insert
  on public.workout_sessions
  for insert
  to authenticated
  with check (client_id = (select auth.uid()));

drop policy if exists workout_sessions_update on public.workout_sessions;
create policy workout_sessions_update
  on public.workout_sessions
  for update
  to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists workout_sets_select on public.workout_sets;
create policy workout_sets_select
  on public.workout_sets
  for select
  to authenticated
  using (
    client_id = (select auth.uid())
    or (select private.tracking_trainer_of(client_id))
  );

drop policy if exists workout_sets_insert on public.workout_sets;
create policy workout_sets_insert
  on public.workout_sets
  for insert
  to authenticated
  with check (
    logged_by = (select auth.uid())
    and exists (
      select 1
      from public.workout_sessions s
      where s.id = session_id
        and s.client_id = workout_sets.client_id
    )
    and (
      (
        client_id = (select auth.uid())
        and logged_by_role = 'client'
      )
      or (
        logged_by_role = 'trainer'
        and (select private.tracking_trainer_of(client_id))
        and exists (
          select 1
          from public.workout_sessions s
          where s.id = session_id
            and s.client_id = workout_sets.client_id
            and s.status = 'in_progress'
        )
      )
    )
  );

drop policy if exists workout_sets_update on public.workout_sets;
create policy workout_sets_update
  on public.workout_sets
  for update
  to authenticated
  using (
    client_id = (select auth.uid())
    or (
      (select private.tracking_trainer_of(client_id))
      and exists (
        select 1
        from public.workout_sessions s
        where s.id = session_id
          and s.client_id = workout_sets.client_id
          and s.status = 'in_progress'
      )
    )
  )
  with check (
    client_id = (select auth.uid())
    or (
      (select private.tracking_trainer_of(client_id))
      and exists (
        select 1
        from public.workout_sessions s
        where s.id = session_id
          and s.client_id = workout_sets.client_id
          and s.status = 'in_progress'
      )
    )
  );

-- The signed-in person saves their own finished session and its sets.
-- A repeated call with the same local id returns the existing session and
-- does not add another attempt. Weight is stored in kilograms.
create or replace function public.tracking_save_session(p_session jsonb, p_sets jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  item jsonb;
  sid uuid;
  local_id text;
  workout_id text;
  workout_name text;
  origin text;
  zone text;
  started timestamptz;
  ended timestamptz;
  day date;
  status text;
  program_id text;
  step_n numeric;
  set_n numeric;
  step int;
  set_number int;
  mode text;
  set_status text;
  unit text;
  lib text;
  stable text;
  ex_name text;
  group_tag text;
  pid uuid;
  bodyweight boolean;
  seen int[] := '{}';
  n int := 0;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if jsonb_typeof(p_session) is distinct from 'object'
     or jsonb_typeof(p_sets) is distinct from 'array' then
    raise exception 'Could not save that session.';
  end if;
  if jsonb_array_length(p_sets) < 1
     or jsonb_array_length(p_sets) > 400
     or octet_length(p_sets::text) > 400000 then
    raise exception 'Could not save that session.';
  end if;

  local_id := nullif(btrim(coalesce(p_session->>'localId', '')), '');
  workout_id := nullif(btrim(coalesce(p_session->>'workoutId', '')), '');
  workout_name := nullif(btrim(coalesce(p_session->>'workoutName', '')), '');
  origin := btrim(coalesce(p_session->>'origin', ''));
  zone := btrim(coalesce(p_session->>'timeZone', ''));
  status := btrim(coalesce(p_session->>'status', ''));
  program_id := nullif(btrim(coalesce(p_session->>'programId', '')), '');
  if local_id is null or local_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'Could not save that session.';
  end if;
  if workout_id is not null and workout_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'Could not save that session.';
  end if;
  if workout_name is not null and char_length(workout_name) > 120 then
    workout_name := left(workout_name, 120);
  end if;
  if origin not in ('own', 'trainer') or status not in ('completed', 'ended_early') then
    raise exception 'Could not save that session.';
  end if;
  if zone !~ '^[A-Za-z0-9_+/-]{1,64}$' then
    raise exception 'Could not save that session.';
  end if;
  if program_id is not null and program_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'Could not save that session.';
  end if;
  begin
    started := (p_session->>'startedAt')::timestamptz;
    ended := (p_session->>'endedAt')::timestamptz;
    day := (p_session->>'localDate')::date;
  exception when others then
    raise exception 'Could not save that session.';
  end;
  if started is null or ended is null or day is null or ended < started then
    raise exception 'Could not save that session.';
  end if;

  insert into public.workout_sessions (
    client_id, local_id, workout_id, workout_name, origin,
    started_at, ended_at, time_zone, local_date, status, program_id
  ) values (
    uid, local_id, workout_id, workout_name, origin,
    started, ended, zone, day, status, program_id
  )
  on conflict on constraint workout_sessions_client_local do nothing
  returning id into sid;

  if sid is null then
    select s.id into sid
    from public.workout_sessions s
    where s.client_id = uid
      and s.local_id = local_id;
    return sid;
  end if;

  for item in select value from jsonb_array_elements(p_sets) loop
    n := n + 1;
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Could not save that set.';
    end if;
    step_n := public.tracking_num(item->>'step');
    set_n := public.tracking_num(item->>'setNumber');
    if step_n is null or set_n is null or step_n <> trunc(step_n) or set_n <> trunc(set_n)
       or step_n < 0 or set_n < 1 then
      raise exception 'Could not save that set.';
    end if;
    step := step_n;
    set_number := set_n;
    if step = any (seen) then
      raise exception 'Could not save that set.';
    end if;
    seen := seen || step;
    mode := btrim(coalesce(item->>'mode', ''));
    set_status := btrim(coalesce(item->>'status', ''));
    unit := btrim(coalesce(item->>'displayUnit', ''));
    if mode not in ('reps', 'intervals', 'timer', 'stopwatch', 'static_hold')
       or set_status not in ('completed', 'skipped')
       or unit not in ('lb', 'kg', 'bodyweight') then
      raise exception 'Could not save that set.';
    end if;
    ex_name := btrim(coalesce(item->>'exerciseName', ''));
    if ex_name = '' or char_length(ex_name) > 200 then
      raise exception 'Could not save that set.';
    end if;
    group_tag := nullif(btrim(coalesce(item->>'groupTag', '')), '');
    if group_tag is not null and char_length(group_tag) > 80 then
      group_tag := left(group_tag, 80);
    end if;
    lib := nullif(btrim(coalesce(item->>'libraryExerciseId', '')), '');
    stable := nullif(btrim(coalesce(item->>'stableKey', '')), '');
    bodyweight := unit = 'bodyweight';
    if lib is not null then
      if lib !~ '^[A-Za-z0-9_-]{1,32}$' then
        raise exception 'Could not save that set.';
      end if;
      pid := null;
    elsif stable is not null and stable ~ '^[A-Za-z0-9_-]{1,80}$' then
      insert into public.personal_exercises (user_id, stable_key, name)
      values (uid, stable, ex_name)
      on conflict (user_id, stable_key) do update
        set name = excluded.name,
            updated_at = now()
      returning id into pid;
    else
      raise exception 'Could not save that set.';
    end if;

    insert into public.workout_sets (
      session_id, client_id, step, library_exercise_id, personal_exercise_id,
      exercise_name, mode, set_number, group_tag, status, removed,
      logged_by, logged_by_role, display_unit,
      planned_reps, planned_reps_min, planned_reps_max,
      planned_weight_kg, planned_bodyweight, actual_reps, actual_weight_kg, actual_bodyweight,
      planned_hold_sec, actual_hold_sec,
      planned_work_sec, actual_work_sec, planned_rest_sec, actual_rest_sec,
      planned_rounds, actual_rounds, planned_total_sec, actual_total_sec,
      planned_lap_count, actual_laps, planned_events, actual_events
    ) values (
      sid, uid, step, lib, pid,
      ex_name, mode, set_number, group_tag, set_status, false,
      uid, 'client', unit,
      public.tracking_num(item->>'plannedReps'),
      public.tracking_num(item->>'plannedRepsMin'),
      public.tracking_num(item->>'plannedRepsMax'),
      case when bodyweight then null else public.tracking_to_kg(public.tracking_num(item->>'plannedWeight'), unit) end,
      bodyweight,
      public.tracking_num(item->>'actualReps'),
      case when bodyweight then null else public.tracking_to_kg(public.tracking_num(item->>'actualWeight'), unit) end,
      bodyweight,
      public.tracking_num(item->>'plannedHoldSec'),
      public.tracking_num(item->>'actualHoldSec'),
      public.tracking_num(item->>'plannedWorkSec'),
      public.tracking_num(item->>'actualWorkSec'),
      public.tracking_num(item->>'plannedRestSec'),
      public.tracking_num(item->>'actualRestSec'),
      public.tracking_num(item->>'plannedRounds'),
      public.tracking_num(item->>'actualRounds'),
      public.tracking_num(item->>'plannedTotalSec'),
      public.tracking_num(item->>'actualTotalSec'),
      public.tracking_num(item->>'plannedLapCount')::integer,
      public.tracking_laps(item->'actualLaps'),
      public.tracking_events(item->'plannedEvents'),
      public.tracking_events(item->'actualEvents')
    );
  end loop;

  return sid;
end;
$$;

revoke all on function public.tracking_to_kg(numeric, text) from public, anon;
revoke all on function public.tracking_num(text) from public, anon;
revoke all on function public.tracking_laps(jsonb) from public, anon;
revoke all on function public.tracking_events(jsonb) from public, anon;
revoke all on function public.tracking_save_session(jsonb, jsonb) from public, anon;
revoke all on function private.tracking_trainer_of(uuid) from public, anon;
revoke all on function private.tracking_session_status(uuid) from public, anon;
revoke all on function private.tracking_personal_guard() from public, anon;
revoke all on function private.tracking_session_guard() from public, anon;
revoke all on function private.tracking_set_guard() from public, anon;

grant execute on function public.tracking_to_kg(numeric, text) to authenticated;
grant execute on function public.tracking_num(text) to authenticated;
grant execute on function public.tracking_laps(jsonb) to authenticated;
grant execute on function public.tracking_events(jsonb) to authenticated;
grant execute on function public.tracking_save_session(jsonb, jsonb) to authenticated;
grant execute on function private.tracking_trainer_of(uuid) to authenticated;
grant execute on function private.tracking_personal_guard() to authenticated;
grant execute on function private.tracking_session_guard() to authenticated;
grant execute on function private.tracking_set_guard() to authenticated;

notify pgrst, 'reload schema';
