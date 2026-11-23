// A trainer can read live tracking only for themselves, a linked Free Client,
// or a linked Enthusiast who is sharing. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';
const I = '55555555-5555-4555-8555-555555555555';
const S = '66666666-6666-4666-8666-666666666666';

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

psql('postgres', 'drop database if exists wb_tracking_read_test;\ncreate database wb_tracking_read_test;\n');
psql('wb_tracking_read_test', `
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
  'supabase/migrations/20261123010000_tracking_can_read.sql',
  'supabase/migrations/20261123010000_tracking_can_read.sql'
].forEach(function (file) { psql('wb_tracking_read_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${F}', 'mia@example.com'),
  ('${E}', 'nina@example.com'),
  ('${P}', 'owen@example.com'),
  ('${I}', 'pat@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'free_client', email = 'mia@example.com', share_with_trainer = false where id = '${F}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'nina@example.com', share_with_trainer = true where id = '${E}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'owen@example.com', share_with_trainer = false where id = '${P}';
update public.profiles set membership = 'none', intended_plan = 'enthusiast', email = 'pat@example.com', share_with_trainer = false where id = '${I}';
update public.profiles set membership = 'trainer', email = 'stranger@example.com' where id = '${S}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${F}'),
  ('${T}', '${E}'),
  ('${T}', '${P}'),
  ('${T}', '${I}');

insert into public.personal_exercises (id, user_id, stable_key, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '${F}', 'ex_mia', 'Mia press'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${E}', 'ex_nina', 'Nina press'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '${P}', 'ex_owen', 'Owen press'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '${I}', 'ex_pat', 'Pat press'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', '${T}', 'ex_coach', 'Coach press');

insert into public.workout_sessions (
  id, client_id, local_id, workout_name, origin, started_at, ended_at, time_zone, local_date, status
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '${F}', 'ses_mia', 'Mia legs', 'own', '2026-11-14T15:00:00Z', '2026-11-14T16:00:00Z', 'UTC', '2026-11-14', 'completed'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '${E}', 'ses_nina', 'Nina flow', 'own', '2026-11-14T15:00:00Z', '2026-11-14T16:00:00Z', 'UTC', '2026-11-14', 'completed'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '${P}', 'ses_owen', 'Owen secret', 'own', '2026-11-14T15:00:00Z', '2026-11-14T16:00:00Z', 'UTC', '2026-11-14', 'completed'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', '${I}', 'ses_pat', 'Pat secret', 'own', '2026-11-14T15:00:00Z', '2026-11-14T16:00:00Z', 'UTC', '2026-11-14', 'completed'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', '${T}', 'ses_coach', 'Coach day', 'own', '2026-11-14T15:00:00Z', '2026-11-14T16:00:00Z', 'UTC', '2026-11-14', 'completed');

insert into public.workout_sets (
  session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
  status, logged_by, logged_by_role, display_unit, actual_reps
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '${F}', 0, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Mia press', 'reps', 1, 'completed', '${F}', 'client', 'lb', 8),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '${E}', 0, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Nina press', 'reps', 1, 'completed', '${E}', 'client', 'lb', 8),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '${P}', 0, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Owen press', 'reps', 1, 'completed', '${P}', 'client', 'lb', 8),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', '${I}', 0, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Pat press', 'reps', 1, 'completed', '${I}', 'client', 'lb', 8),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', '${T}', 0, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'Coach press', 'reps', 1, 'completed', '${T}', 'client', 'lb', 8);

do $$
declare
  sessions text;
  sets text;
  exercises text;
  updated text;
begin
  if pg_get_functiondef('private.tracking_can_read(uuid)'::regprocedure) not like '%share_with_trainer%' then
    raise exception 'helper does not read the sharing flag';
  end if;
  if pg_get_functiondef('private.tracking_trainer_of(uuid)'::regprocedure) like '%share_with_trainer%' then
    raise exception 'tracking_trainer_of started checking sharing';
  end if;
  select pg_get_expr(p.polqual, p.polrelid) into sessions
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'workout_sessions' and p.polname = 'workout_sessions_select';
  select pg_get_expr(p.polqual, p.polrelid) into sets
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'workout_sets' and p.polname = 'workout_sets_select';
  select pg_get_expr(p.polqual, p.polrelid) into exercises
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'personal_exercises' and p.polname = 'personal_exercises_select';
  if sessions not like '%tracking_can_read%' or sets not like '%tracking_can_read%' or exercises not like '%tracking_can_read%' then
    raise exception 'select policies % / % / %', sessions, sets, exercises;
  end if;
  select pg_get_expr(p.polqual, p.polrelid) into updated
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'workout_sets' and p.polname = 'workout_sets_update';
  if updated not like '%tracking_trainer_of%' then
    raise exception 'set updates no longer use the link helper %', updated;
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);

do $$
declare
  n int;
begin
  if private.tracking_can_read('${T}') is distinct from true then
    raise exception 'trainer cannot read their own rows';
  end if;
  if private.tracking_can_read('${F}') is distinct from true then
    raise exception 'free client was hidden';
  end if;
  if private.tracking_can_read('${E}') is distinct from true then
    raise exception 'sharing enthusiast was hidden';
  end if;
  if private.tracking_can_read('${P}') is distinct from false then
    raise exception 'private enthusiast was readable';
  end if;
  if private.tracking_can_read('${I}') is distinct from false then
    raise exception 'intended-plan enthusiast was readable';
  end if;
  if private.tracking_trainer_of('${P}') is distinct from true
     or private.tracking_trainer_of('${E}') is distinct from true
     or private.tracking_trainer_of('${F}') is distinct from true then
    raise exception 'the link helper changed';
  end if;

  select count(*) into n from public.workout_sessions where client_id = '${F}';
  if n <> 1 then raise exception 'free client sessions %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${F}';
  if n <> 1 then raise exception 'free client sets %', n; end if;
  select count(*) into n from public.personal_exercises where user_id = '${F}';
  if n <> 1 then raise exception 'free client exercises %', n; end if;
  select count(*) into n from public.workout_sessions where client_id = '${E}';
  if n <> 1 then raise exception 'shared enthusiast sessions %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${E}';
  if n <> 1 then raise exception 'shared enthusiast sets %', n; end if;
  select count(*) into n from public.personal_exercises where user_id = '${E}';
  if n <> 1 then raise exception 'shared enthusiast exercises %', n; end if;
  select count(*) into n from public.workout_sessions where client_id in ('${P}', '${I}');
  if n <> 0 then raise exception 'private sessions leaked %', n; end if;
  select count(*) into n from public.workout_sets where client_id in ('${P}', '${I}');
  if n <> 0 then raise exception 'private sets leaked %', n; end if;
  select count(*) into n from public.personal_exercises where user_id in ('${P}', '${I}');
  if n <> 0 then raise exception 'private exercises leaked %', n; end if;
  select count(*) into n from public.workout_sessions where client_id = '${T}';
  if n <> 1 then raise exception 'trainer lost their own session %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${P}', false);
do $$
declare n int;
begin
  if private.tracking_can_read('${P}') is distinct from true then
    raise exception 'owner lost their own rows';
  end if;
  select count(*) into n from public.workout_sessions where client_id = '${P}';
  if n <> 1 then raise exception 'owner cannot see their session %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${P}';
  if n <> 1 then raise exception 'owner cannot see their sets %', n; end if;
  select count(*) into n from public.workout_sessions where client_id = '${F}';
  if n <> 0 then raise exception 'enthusiast read another client %', n; end if;
end $$;

reset role;
update public.profiles set share_with_trainer = false where id = '${E}';
update public.profiles set share_with_trainer = true where id = '${P}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions where client_id = '${E}';
  if n <> 0 then raise exception 'turning sharing off still left sessions %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${E}';
  if n <> 0 then raise exception 'turning sharing off still left sets %', n; end if;
  select count(*) into n from public.personal_exercises where user_id = '${E}';
  if n <> 0 then raise exception 'turning sharing off still left exercises %', n; end if;
  if private.tracking_trainer_of('${E}') is distinct from true then
    raise exception 'ending sharing also ended the link';
  end if;
  select count(*) into n from public.workout_sessions where client_id = '${P}';
  if n <> 1 then raise exception 'turning sharing on did not open sessions %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${P}';
  if n <> 1 then raise exception 'turning sharing on did not open sets %', n; end if;
end $$;

reset role;
update public.trainer_clients set ended_at = now() where trainer_id = '${T}' and client_id = '${F}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  if private.tracking_trainer_of('${F}') is distinct from false then
    raise exception 'an ended link still counts';
  end if;
  select count(*) into n from public.workout_sessions where client_id = '${F}';
  if n <> 0 then raise exception 'ended link still sees the free client %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${F}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions where client_id = '${F}';
  if n <> 1 then raise exception 'free client lost their own session %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions where client_id <> '${S}';
  if n <> 0 then raise exception 'stranger sees sessions %', n; end if;
  if private.tracking_can_read('${F}') is distinct from false then
    raise exception 'stranger can read a free client';
  end if;
end $$;

reset role;
set role anon;
do $$
begin
  perform private.tracking_can_read('${F}');
  raise exception 'anon executed tracking_can_read';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  perform count(*) from public.workout_sessions;
  raise exception 'anon read sessions';
exception when insufficient_privilege then
  null;
end $$;
`;

psql('wb_tracking_read_test', assertSql);
console.log('TRACKING READ SQL OK');
