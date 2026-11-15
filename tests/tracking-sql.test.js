// Session and set access. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const C = '22222222-2222-4222-8222-222222222222';
const T = '11111111-1111-4111-8111-111111111111';
const S = '44444444-4444-4444-8444-444444444444';
const N = '55555555-5555-4555-8555-555555555555';
function psql(db, sql, file) {
  const args = ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', db];
  const opts = { encoding: 'utf8' };
  if (file) args.push('-f', file);
  else {
    args.push('-f', '-');
    opts.input = sql;
  }
  const res = spawnSync('sudo', args, opts);
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
    process.exit(res.status || 1);
  }
  return res.stdout || '';
}

psql('postgres', 'drop database if exists wb_tracking_test;\ncreate database wb_tracking_test;\n');
psql('wb_tracking_test', `
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`);
[
  'supabase/migrations/20261106150000_profiles.sql',
  'supabase/migrations/20261107160000_invites.sql',
  'supabase/migrations/20261115180000_workout_tracking.sql',
  'supabase/migrations/20261115180000_workout_tracking.sql'
].forEach(function (file) { psql('wb_tracking_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${C}', 'ada@example.com'),
  ('${T}', 'coach@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${N}', 'neil@example.com');
update public.profiles set membership = 'enthusiast', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'enthusiast', email = 'stranger@example.com' where id = '${S}';
update public.profiles set membership = 'free_client', email = 'neil@example.com' where id = '${N}';
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);

do $$
declare
  sid uuid;
  again uuid;
  pid uuid;
  n int;
  kg numeric;
  laps text;
  mark text;
begin
  if public.tracking_to_kg(140, 'lb') is distinct from (140 * 0.45359237) then
    raise exception 'lb to kg %', public.tracking_to_kg(140, 'lb');
  end if;
  if public.tracking_to_kg(16, 'kg') is distinct from 16::numeric then
    raise exception 'kg stayed %', public.tracking_to_kg(16, 'kg');
  end if;
  if public.tracking_to_kg(20, 'bodyweight') is not null or public.tracking_to_kg(-1, 'lb') is not null then
    raise exception 'weight was not dropped';
  end if;

  sid := public.tracking_save_session(
    jsonb_build_object(
      'localId', 'ses_finish',
      'workoutId', 'wo_am',
      'workoutName', 'Morning',
      'origin', 'own',
      'startedAt', '2026-11-15T22:10:00Z',
      'endedAt', '2026-11-15T22:30:00Z',
      'timeZone', 'America/New_York',
      'localDate', '2026-11-15',
      'status', 'ended_early',
      'programId', 'pg1'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'step', 0, 'setNumber', 1, 'groupTag', 'ss1', 'status', 'completed',
        'stableKey', 'ex_squat', 'exerciseName', 'Squat', 'mode', 'reps', 'displayUnit', 'lb',
        'plannedReps', 10, 'plannedWeight', 135, 'actualReps', 11, 'actualWeight', 140
      ),
      jsonb_build_object(
        'step', 1, 'setNumber', 1, 'groupTag', 'ss1', 'status', 'skipped',
        'stableKey', 'ex_plank', 'exerciseName', 'Plank', 'mode', 'static_hold', 'displayUnit', 'bodyweight',
        'actualHoldSec', null
      ),
      jsonb_build_object(
        'step', 2, 'setNumber', 1, 'status', 'completed',
        'libraryExerciseId', '0101', 'exerciseName', 'Swing', 'mode', 'timer', 'displayUnit', 'kg',
        'plannedWorkSec', 30, 'plannedRestSec', 15, 'actualWorkSec', 12, 'actualReps', 9, 'actualRounds', 1,
        'plannedWeight', 16, 'actualWeight', 16
      ),
      jsonb_build_object(
        'step', 3, 'setNumber', 1, 'status', 'completed',
        'stableKey', 'ex_shuttle', 'exerciseName', 'Shuttle', 'mode', 'stopwatch', 'displayUnit', 'bodyweight',
        'plannedLapCount', 2, 'actualTotalSec', 6.984,
        'actualLaps', '[{"n":1,"lapSec":3.21,"totalSec":3.21},{"n":2,"lapSec":3.774,"totalSec":6.984}]'::jsonb,
        'plannedEvents', '[{"lap":1,"name":"Finish line"},{"lap":2,"name":"Unused"}]'::jsonb,
        'actualEvents', '[{"lap":1,"name":"Finish line","result":"pass"}]'::jsonb
      )
    )
  );
  select count(*) into n from public.workout_sets where session_id = sid;
  if n <> 4 then raise exception 'set count %', n; end if;
  select actual_weight_kg into kg from public.workout_sets where session_id = sid and step = 0;
  if kg is distinct from public.tracking_to_kg(140, 'lb') then raise exception 'stored kg %', kg; end if;
  if (select display_unit from public.workout_sets where session_id = sid and step = 0) is distinct from 'lb' then
    raise exception 'display unit dropped';
  end if;
  if (select logged_by_role from public.workout_sets where session_id = sid and step = 0) is distinct from 'client' then
    raise exception 'logger role';
  end if;
  if (select actual_weight_kg from public.workout_sets where session_id = sid and step = 1) is not null
     or (select actual_bodyweight from public.workout_sets where session_id = sid and step = 1) is distinct from true
     or (select status from public.workout_sets where session_id = sid and step = 1) is distinct from 'skipped' then
    raise exception 'skipped hold was stored wrong';
  end if;
  if (select library_exercise_id from public.workout_sets where session_id = sid and step = 2) is distinct from '0101'
     or (select personal_exercise_id from public.workout_sets where session_id = sid and step = 2) is not null
     or (select actual_work_sec from public.workout_sets where session_id = sid and step = 2) is distinct from 12
     or (select actual_rest_sec from public.workout_sets where session_id = sid and step = 2) is not null
     or (select planned_rest_sec from public.workout_sets where session_id = sid and step = 2) is distinct from 15 then
    raise exception 'timer measures';
  end if;
  select actual_laps::text, actual_events->0->>'result'
    into laps, mark
  from public.workout_sets where session_id = sid and step = 3;
  if position('3.21' in laps) = 0 or mark is distinct from 'pass' then
    raise exception 'stopwatch % %', laps, mark;
  end if;
  if (select local_date::text from public.workout_sessions where id = sid) is distinct from '2026-11-15'
     or (select status from public.workout_sessions where id = sid) is distinct from 'ended_early'
     or (select origin from public.workout_sessions where id = sid) is distinct from 'own'
     or (select time_zone from public.workout_sessions where id = sid) is distinct from 'America/New_York'
     or (select program_id from public.workout_sessions where id = sid) is distinct from 'pg1' then
    raise exception 'session columns';
  end if;

  again := public.tracking_save_session(
    jsonb_build_object(
      'localId', 'ses_finish', 'origin', 'own', 'status', 'completed',
      'startedAt', '2026-11-15T22:10:00Z', 'endedAt', '2026-11-15T22:40:00Z',
      'timeZone', 'UTC', 'localDate', '2026-11-15'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'step', 0, 'setNumber', 1, 'status', 'completed', 'stableKey', 'ex_other',
        'exerciseName', 'Other', 'mode', 'reps', 'displayUnit', 'kg', 'actualReps', 99
      )
    )
  );
  if again is distinct from sid then raise exception 'retry id %', again; end if;
  select count(*) into n from public.workout_sets where session_id = sid;
  if n <> 4 then raise exception 'retry added a set %', n; end if;
  if (select actual_reps from public.workout_sets where session_id = sid and step = 0) is distinct from 11 then
    raise exception 'retry replaced the last attempt';
  end if;

  perform public.tracking_save_session(
    jsonb_build_object(
      'localId', 'ses_rename', 'origin', 'trainer', 'status', 'completed',
      'startedAt', '2026-11-16T15:00:00Z', 'endedAt', '2026-11-16T15:20:00Z',
      'timeZone', 'UTC', 'localDate', '2026-11-16', 'workoutId', 'wo_am', 'workoutName', 'Morning'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'step', 0, 'setNumber', 1, 'status', 'completed', 'stableKey', 'ex_squat',
        'exerciseName', 'Back squat', 'mode', 'reps', 'displayUnit', 'lb',
        'plannedReps', 8, 'actualReps', 8, 'actualWeight', 145
      )
    )
  );
  select count(*) into n from public.personal_exercises where user_id = '${C}' and stable_key = 'ex_squat';
  if n <> 1 then raise exception 'rename split the exercise %', n; end if;
  select id into pid from public.personal_exercises where user_id = '${C}' and stable_key = 'ex_squat';
  select count(*) into n from public.workout_sets where personal_exercise_id = pid;
  if n <> 2 then raise exception 'sets did not share the exercise %', n; end if;
  if (select name from public.personal_exercises where id = pid) is distinct from 'Back squat' then
    raise exception 'current name was not kept';
  end if;
  if (select exercise_name from public.workout_sets where session_id = sid and step = 0) is distinct from 'Squat' then
    raise exception 'the name shown on the first session changed';
  end if;
end $$;

-- A trainer can read, and can log a set only while the session is in progress.
select set_config('request.jwt.claim.sub', '${C}', false);
insert into public.workout_sessions (
  client_id, local_id, workout_id, workout_name, origin, started_at, time_zone, local_date, status
) values (
  '${C}', 'ses_live', 'wo_am', 'Morning', 'own', '2026-11-15T23:00:00Z', 'America/New_York', '2026-11-15', 'in_progress'
);
insert into public.personal_exercises (user_id, stable_key, name)
values ('${C}', 'ex_press', 'Press')
on conflict (user_id, stable_key) do update set name = excluded.name;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; sid uuid; pid uuid;
begin
  select count(*) into n from public.workout_sessions where client_id = '${C}';
  if n <> 3 then raise exception 'trainer read sessions %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${C}';
  if n <> 5 then raise exception 'trainer read sets %', n; end if;
  select id into sid from public.workout_sessions where local_id = 'ses_live';
  select id into pid from public.personal_exercises where stable_key = 'ex_press';
  insert into public.workout_sets (
    session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
    status, logged_by, logged_by_role, display_unit, planned_reps, actual_reps, planned_bodyweight, actual_bodyweight
  ) values (
    sid, '${C}', 0, pid, 'Press', 'reps', 1,
    'completed', '${T}', 'trainer', 'kg', 8, 6, false, false
  );
  update public.workout_sets
    set actual_reps = 7, logged_by = '${T}', logged_by_role = 'trainer'
    where session_id = sid and step = 0;
  select count(*) into n from public.workout_sets where session_id = sid;
  if n <> 1 then raise exception 'redo inserted another attempt %', n; end if;
  if (select actual_reps from public.workout_sets where session_id = sid and step = 0) is distinct from 7 then
    raise exception 'last attempt was not kept';
  end if;
  begin
    insert into public.workout_sets (
      session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
      status, logged_by, logged_by_role, display_unit
    )
    select id, client_id, 9, pid, 'Press', 'reps', 2, 'completed', '${T}', 'trainer', 'kg'
    from public.workout_sessions where local_id = 'ses_finish';
    raise exception 'trainer wrote a finished session';
  exception when others then
    if sqlerrm not like '%in progress%' and sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

reset role;
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${N}');
set role authenticated;
select set_config('request.jwt.claim.sub', '${N}', false);
insert into public.workout_sessions (
  client_id, local_id, workout_id, workout_name, origin, started_at, time_zone, local_date, status
) values (
  '${N}', 'ses_neil', 'wo_neil', 'Neil', 'own', '2026-11-15T23:05:00Z', 'UTC', '2026-11-15', 'in_progress'
);
insert into public.personal_exercises (user_id, stable_key, name)
values ('${N}', 'ex_neil', 'Neil press');

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare sid uuid; other uuid; own uuid; n int;
begin
  select id into sid from public.workout_sessions where local_id = 'ses_neil';
  select id into other from public.personal_exercises where user_id = '${C}' and stable_key = 'ex_press';
  select id into own from public.personal_exercises where user_id = '${N}' and stable_key = 'ex_neil';
  begin
    insert into public.workout_sets (
      session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
      status, logged_by, logged_by_role, display_unit
    ) values (
      sid, '${N}', 0, other, 'Press', 'reps', 1,
      'completed', '${T}', 'trainer', 'kg'
    );
    raise exception 'trainer attached another client exercise';
  exception when others then
    if sqlerrm not like '%belongs to someone else%' then raise; end if;
  end;
  insert into public.workout_sets (
    session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
    status, logged_by, logged_by_role, display_unit
  ) values (
    sid, '${N}', 0, own, 'Neil press', 'reps', 1,
    'completed', '${T}', 'trainer', 'kg'
  );
  select count(*) into n from public.workout_sets where session_id = sid;
  if n <> 1 then raise exception 'own exercise was not logged %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
update public.workout_sessions
  set status = 'completed', ended_at = '2026-11-15T23:20:00Z'
  where local_id = 'ses_live';

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  update public.workout_sets set actual_reps = 99
    where client_id = '${C}' and exercise_name = 'Press';
  if found then raise exception 'trainer edited after the session ended'; end if;
  select actual_reps into n from public.workout_sets where client_id = '${C}' and exercise_name = 'Press';
  if n is distinct from 7 then raise exception 'finished reps changed %', n; end if;
  update public.workout_sessions set workout_name = 'Hacked' where client_id = '${C}';
  if found then raise exception 'trainer edited a session'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  update public.workout_sets set actual_reps = 3 where session_id in (
    select id from public.workout_sessions where local_id = 'ses_live'
  );
  raise exception 'client rewrote a finished set';
exception when others then
  if sqlerrm not like '%marked removed%' then raise; end if;
end $$;
update public.workout_sets set removed = true where session_id in (
  select id from public.workout_sessions where local_id = 'ses_live'
);
do $$
begin
  if (select removed from public.workout_sets where exercise_name = 'Press') is distinct from true then
    raise exception 'soft remove did not stick';
  end if;
  delete from public.workout_sets where exercise_name = 'Press';
  raise exception 'client hard-deleted a set';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  delete from public.workout_sessions where local_id = 'ses_live';
  raise exception 'client hard-deleted a session';
exception when insufficient_privilege then
  null;
end $$;

reset role;
grant delete on public.workout_sets to authenticated;
grant delete on public.workout_sessions to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  delete from public.workout_sets where exercise_name = 'Press';
  select count(*) into n from public.workout_sets where exercise_name = 'Press';
  if n <> 1 then raise exception 'a grant deleted a set %', n; end if;
  delete from public.workout_sessions where local_id = 'ses_live';
  select count(*) into n from public.workout_sessions where local_id = 'ses_live';
  if n <> 1 then raise exception 'a grant deleted a session %', n; end if;
end $$;

reset role;
drop policy if exists workout_sets_delete_test on public.workout_sets;
drop policy if exists workout_sessions_delete_test on public.workout_sessions;
create policy workout_sets_delete_test on public.workout_sets for delete to authenticated using (true);
create policy workout_sessions_delete_test on public.workout_sessions for delete to authenticated using (true);
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  delete from public.workout_sets where exercise_name = 'Press';
  raise exception 'policy allowed a hard delete';
exception when others then
  if sqlerrm not like '%Mark the set removed%' then raise; end if;
end $$;
do $$
begin
  delete from public.workout_sessions where local_id = 'ses_live';
  raise exception 'policy allowed a session delete';
exception when others then
  if sqlerrm not like '%Sessions are kept%' then raise; end if;
end $$;
reset role;
drop policy if exists workout_sets_delete_test on public.workout_sets;
drop policy if exists workout_sessions_delete_test on public.workout_sessions;

reset role;
revoke delete on public.workout_sets from authenticated;
revoke delete on public.workout_sessions from authenticated;
update public.trainer_clients set ended_at = now() where trainer_id = '${T}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions;
  if n <> 0 then raise exception 'ended link still sees sessions %', n; end if;
  select count(*) into n from public.workout_sets;
  if n <> 0 then raise exception 'ended link still sees sets %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions where client_id = '${C}';
  if n <> 3 then raise exception 'client lost history %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${C}';
  if n <> 6 then raise exception 'client lost sets %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions;
  if n <> 0 then raise exception 'stranger sees sessions %', n; end if;
  begin
    insert into public.workout_sets (
      session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
      status, logged_by, logged_by_role, display_unit
    )
    select id, '${C}', 4, null, 'Hack', 'reps', 1, 'completed', '${S}', 'trainer', 'kg'
    from public.workout_sessions where false;
    insert into public.workout_sessions (
      client_id, local_id, origin, started_at, ended_at, time_zone, local_date, status
    ) values (
      '${C}', 'ses_hack', 'own', now(), now(), 'UTC', current_date, 'completed'
    );
    raise exception 'stranger inserted a session';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%performed it%' then raise; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare n int; pid uuid;
begin
  select id into pid from public.personal_exercises where user_id = '${C}' and stable_key = 'ex_squat';
  begin
    delete from public.personal_exercises where id = pid;
    raise exception 'an exercise delete was allowed';
  exception when foreign_key_violation then
    null;
  end;
  select count(*) into n from public.workout_sets where personal_exercise_id = pid;
  if n <> 2 then raise exception 'exercise delete removed sets %', n; end if;
end $$;
delete from auth.users where id = '${C}';
do $$
declare n int;
begin
  select count(*) into n from public.workout_sets where client_id = '${C}';
  if n <> 0 then raise exception 'account delete left sets %', n; end if;
  select count(*) into n from public.personal_exercises where user_id = '${C}';
  if n <> 0 then raise exception 'account delete left exercises %', n; end if;
  select count(*) into n from public.workout_sessions where client_id = '${C}';
  if n <> 0 then raise exception 'account delete left sessions %', n; end if;
end $$;

reset role;
set role anon;
do $$
begin
  perform count(*) from public.workout_sessions;
  raise exception 'anon read sessions';
exception when insufficient_privilege then
  null;
end $$;
`;

psql('wb_tracking_test', assertSql);
console.log('TRACKING SQL OK');
