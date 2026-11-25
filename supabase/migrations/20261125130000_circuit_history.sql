-- Group circuit history. A trainer saves one finished run. Linked clients each
-- get their own session. A retry of the same run id does not add another copy.
-- Manual names stay on the coach's circuit_runs row. No emails.

alter table public.workout_sessions drop constraint if exists workout_sessions_origin;
alter table public.workout_sessions
  add constraint workout_sessions_origin check (origin in ('own', 'trainer', 'circuit'));

create or replace function private.tracking_circuit_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_setting('wb.circuit_save', true) = 'on';
$$;

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
  if private.tracking_circuit_write()
     and (new.user_id = auth.uid() or private.tracking_trainer_of(new.user_id)) then
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
    return new;
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
  if tg_op = 'INSERT' and private.tracking_circuit_write() and new.origin = 'circuit' then
    if new.status not in ('completed', 'ended_early') or new.ended_at is null or new.ended_at < new.started_at then
      raise exception 'A finished session needs an end time.';
    end if;
    if new.client_id is distinct from auth.uid() and not private.tracking_trainer_of(new.client_id) then
      raise exception 'Choose a linked client.';
    end if;
    return new;
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
  if tg_op = 'INSERT' and private.tracking_circuit_write() and exists (
    select 1 from public.workout_sessions s
    where s.id = new.session_id and s.origin = 'circuit' and s.client_id = new.client_id
  ) then
    if new.logged_by is distinct from uid or new.logged_by_role is distinct from 'trainer' then
      raise exception 'A trainer logs a circuit set.';
    end if;
    return new;
  end if;
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

create table if not exists public.circuit_runs (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  run_id text not null,
  circuit_name text not null,
  status text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  manual jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint circuit_runs_run_len check (char_length(run_id) between 1 and 80),
  constraint circuit_runs_run_shape check (run_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint circuit_runs_name_len check (char_length(btrim(circuit_name)) between 1 and 120),
  constraint circuit_runs_status check (status in ('completed', 'ended_early')),
  constraint circuit_runs_ended check (ended_at >= started_at),
  constraint circuit_runs_trainer_run unique (trainer_id, run_id)
);

alter table public.circuit_runs enable row level security;
revoke all on public.circuit_runs from public, anon, authenticated;
grant select on public.circuit_runs to authenticated;

drop policy if exists circuit_runs_select on public.circuit_runs;
create policy circuit_runs_select
  on public.circuit_runs
  for select
  to authenticated
  using (trainer_id = (select auth.uid()));

create or replace function public.circuit_save_run(p_run jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  run_key text;
  cname text;
  cid text;
  st text;
  started timestamptz;
  ended timestamptz;
  zone text;
  work_sec numeric;
  move_sec numeric;
  person jsonb;
  round jsonb;
  station jsonb;
  linked_id uuid;
  seen uuid[] := '{}';
  manual jsonb := '[]'::jsonb;
  inserted uuid;
  session_id uuid;
  library text;
  personal uuid;
  step_no int;
  station_name text;
  station_id text;
  work_actual numeric;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  if me.membership not in ('trainer', 'master_trainer')
     and coalesce(me.intended_plan, '') not in ('trainer', 'master_trainer') then
    raise exception 'Only a trainer can save a circuit.';
  end if;
  if jsonb_typeof(p_run) is distinct from 'object' then
    raise exception 'That circuit could not be saved.';
  end if;
  run_key := btrim(coalesce(p_run->>'runId', ''));
  cname := btrim(coalesce(p_run->>'name', ''));
  cid := left(regexp_replace(btrim(coalesce(p_run->>'circuitId', 'circuit')), '[^A-Za-z0-9_-]', '', 'g'), 72);
  st := case when p_run->>'status' = 'ended_early' then 'ended_early' else 'completed' end;
  if run_key !~ '^[A-Za-z0-9_-]{1,80}$' or cname = '' or char_length(cname) > 120 or position('@' in cname) > 0 then
    raise exception 'That circuit could not be saved.';
  end if;
  if cid = '' then cid := 'circuit'; end if;
  begin
    started := (p_run->>'startedAt')::timestamptz;
    ended := (p_run->>'endedAt')::timestamptz;
  exception when others then
    raise exception 'That circuit could not be saved.';
  end;
  if started is null or ended is null or ended < started then
    raise exception 'That circuit could not be saved.';
  end if;
  zone := btrim(coalesce(p_run->>'timeZone', 'UTC'));
  if zone = '' or char_length(zone) > 64 then zone := 'UTC'; end if;
  work_sec := greatest(0, coalesce((p_run->>'workSec')::numeric, 0));
  move_sec := greatest(0, coalesce((p_run->>'moveSec')::numeric, 0));
  if jsonb_typeof(p_run->'people') is distinct from 'array' then
    raise exception 'That circuit could not be saved.';
  end if;

  for person in select value from jsonb_array_elements(p_run->'people')
  loop
    if btrim(coalesce(person->>'clientId', '')) = '' then
      manual := manual || jsonb_build_array(jsonb_build_object(
        'name', case when position('@' in coalesce(person->>'name', '')) > 0 or btrim(coalesce(person->>'name', '')) = '' then 'Client' else left(person->>'name', 80) end,
        'rounds', coalesce(person->'rounds', '[]'::jsonb)
      ));
    else
      begin
        linked_id := (person->>'clientId')::uuid;
      exception when invalid_text_representation then
        raise exception 'Choose a linked client.';
      end;
      if linked_id = any (seen) then
        continue;
      end if;
      seen := seen || linked_id;
      if not exists (
        select 1 from public.trainer_clients tc
        where tc.trainer_id = uid and tc.client_id = linked_id and tc.ended_at is null
      ) then
        raise exception 'Choose a linked client.';
      end if;
    end if;
  end loop;

  insert into public.circuit_runs (trainer_id, run_id, circuit_name, status, started_at, ended_at, manual)
  values (uid, run_key, cname, st, started, ended, manual)
  on conflict (trainer_id, run_id) do nothing
  returning id into inserted;
  if inserted is null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'runId', run_key);
  end if;

  perform set_config('wb.circuit_save', 'on', true);

  insert into public.workout_sessions (
    client_id, local_id, workout_id, workout_name, origin, started_at, ended_at, time_zone, local_date, status
  ) values (
    uid, run_key, left('circuit-' || cid, 80), cname, 'circuit', started, ended, zone,
    (started at time zone zone)::date, st
  )
  on conflict (client_id, local_id) do nothing
  returning id into session_id;

  if session_id is not null and jsonb_typeof(p_run->'stations') = 'array' then
    step_no := 0;
    for station in select value from jsonb_array_elements(p_run->'stations')
    loop
      step_no := step_no + 1;
      station_id := left(regexp_replace(btrim(coalesce(station->>'id', '')), '[^A-Za-z0-9_-]', '', 'g'), 40);
      station_name := btrim(coalesce(station->>'name', 'Station'));
      if position('@' in station_name) > 0 or station_name = '' then station_name := 'Station'; end if;
      library := btrim(coalesce(station->>'libraryId', ''));
      if library !~ '^[A-Za-z0-9_-]{1,32}$' then library := ''; end if;
      personal := null;
      if library = '' and station_id <> '' then
        insert into public.personal_exercises (user_id, stable_key, name)
        values (uid, left('c' || station_id, 80), left(station_name, 200))
        on conflict (user_id, stable_key) do update set name = excluded.name
        returning id into personal;
      end if;
      if library = '' and personal is null then continue; end if;
      insert into public.workout_sets (
        session_id, client_id, step, library_exercise_id, personal_exercise_id, exercise_name,
        mode, set_number, status, logged_by, logged_by_role, display_unit,
        planned_work_sec, actual_work_sec, planned_rest_sec, actual_rest_sec
      ) values (
        session_id, uid, step_no, nullif(library, ''), personal, left(station_name, 200),
        'timer', step_no, 'completed', uid, 'trainer', 'bodyweight',
        work_sec, work_sec, move_sec, move_sec
      );
    end loop;
  end if;

  for person in select value from jsonb_array_elements(p_run->'people')
  loop
    if btrim(coalesce(person->>'clientId', '')) = '' then continue; end if;
    linked_id := (person->>'clientId')::uuid;
    session_id := null;
    insert into public.workout_sessions (
      client_id, local_id, workout_id, workout_name, origin, started_at, ended_at, time_zone, local_date, status
    ) values (
      linked_id, run_key, left('circuit-' || cid, 80), cname, 'circuit', started, ended, zone,
      (started at time zone zone)::date, st
    )
    on conflict (client_id, local_id) do nothing
    returning id into session_id;
    if session_id is null or jsonb_typeof(person->'rounds') is distinct from 'array' then continue; end if;
    step_no := 0;
    for round in select value from jsonb_array_elements(person->'rounds')
    loop
      if coalesce(round->>'benched', '') = 'true' then continue; end if;
      station_id := left(regexp_replace(btrim(coalesce(round->>'stationId', '')), '[^A-Za-z0-9_-]', '', 'g'), 40);
      work_actual := greatest(0, coalesce((round->>'workSec')::numeric, work_sec));
      select value into station
      from jsonb_array_elements(coalesce(p_run->'stations', '[]'::jsonb)) value
      where left(regexp_replace(btrim(coalesce(value->>'id', '')), '[^A-Za-z0-9_-]', '', 'g'), 40) = station_id
      limit 1;
      if station is null then continue; end if;
      station_name := btrim(coalesce(station->>'name', 'Station'));
      if position('@' in station_name) > 0 or station_name = '' then station_name := 'Station'; end if;
      library := btrim(coalesce(station->>'libraryId', ''));
      if library !~ '^[A-Za-z0-9_-]{1,32}$' then library := ''; end if;
      personal := null;
      if library = '' and station_id <> '' then
        insert into public.personal_exercises (user_id, stable_key, name)
        values (linked_id, left('c' || station_id, 80), left(station_name, 200))
        on conflict (user_id, stable_key) do update set name = excluded.name
        returning id into personal;
      end if;
      if library = '' and personal is null then continue; end if;
      step_no := step_no + 1;
      insert into public.workout_sets (
        session_id, client_id, step, library_exercise_id, personal_exercise_id, exercise_name,
        mode, set_number, status, logged_by, logged_by_role, display_unit,
        planned_work_sec, actual_work_sec, planned_rest_sec, actual_rest_sec
      ) values (
        session_id, linked_id, step_no, nullif(library, ''), personal, left(station_name, 200),
        'timer', step_no, 'completed', uid, 'trainer', 'bodyweight',
        work_sec, work_actual, move_sec, move_sec
      );
    end loop;
  end loop;

  perform set_config('wb.circuit_save', 'off', true);
  return jsonb_build_object('ok', true, 'duplicate', false, 'runId', run_key);
exception
  when others then
    perform set_config('wb.circuit_save', 'off', true);
    raise;
end;
$$;

revoke all on function public.circuit_save_run(jsonb) from public, anon, authenticated;
grant execute on function public.circuit_save_run(jsonb) to authenticated;
