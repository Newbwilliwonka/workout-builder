// Shared dashboard access. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const M = '33333333-3333-4333-8333-333333333333';
const C = '22222222-2222-4222-8222-222222222222';
const E = '66666666-6666-4666-8666-666666666666';
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

psql('postgres', 'drop database if exists wb_shares_test;\ncreate database wb_shares_test;\n');
psql('wb_shares_test', `
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
  'supabase/migrations/20261116150000_shared_dashboards.sql',
  'supabase/migrations/20261116150000_shared_dashboards.sql'
].forEach(function (file) { psql('wb_shares_test', null, path.join(root, file)); });

psql('wb_shares_test', 'alter table public.profiles add column if not exists display_name text;');

const cards = `jsonb_build_object(
  'order', jsonb_build_array('plan','workouts','pass'),
  'blocks', jsonb_build_object('plan', jsonb_build_object('pct', 91))
)`;

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${C}', 'maya@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${N}', 'neil@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com', display_name = 'Coach Ana' where id = '${T}';
update public.profiles set membership = 'master_trainer', email = 'master@example.com', display_name = 'Master Mo' where id = '${M}';
update public.profiles set membership = 'free_client', email = 'maya@example.com', display_name = 'Maya Chen' where id = '${C}';
update public.profiles set membership = 'enthusiast', email = 'fan@example.com' where id = '${E}';
update public.profiles set membership = 'free_client', email = 'neil@example.com' where id = '${N}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${M}', '${N}');

do $$
declare def text; a int; b int; c int; d int;
begin
  def := pg_get_functiondef('public.tracking_clear_client()'::regprocedure);
  a := position('shared_dashboards' in def);
  b := position('workout_sessions' in def);
  c := position('workout_sets' in def);
  d := position('personal_exercises' in def);
  if a = 0 or b = 0 or c = 0 or d = 0 then
    raise exception 'cleanup is missing a delete';
  end if;
  if not (a < b and b < c and c < d) then
    raise exception 'cleanup order is wrong % % % %', a, b, c, d;
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);

do $$
declare sid uuid; seen text; n int;
begin
  insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
  values ('${C}', '${T}', 'Spoof', current_date, ${cards})
  returning id, trainer_name into sid, seen;
  if seen is distinct from 'Coach Ana' then
    raise exception 'stamp kept the supplied name %', seen;
  end if;
  select count(*) into n from public.shared_dashboards where id = sid and viewed_at is null;
  if n <> 1 then raise exception 'new share was already opened'; end if;

  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${N}', '${T}', 'Coach Ana', current_date, ${cards});
    raise exception 'trainer inserted for someone else''s client';
  exception when others then
    if sqlerrm like '%trainer inserted%' then raise; end if;
  end;

  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${C}', '${T}', 'Coach Ana', current_date, jsonb_build_object(
      'order', jsonb_build_array('plan','plan'),
      'blocks', jsonb_build_object('plan', jsonb_build_object('pct', 1))
    ));
    raise exception 'duplicate cards were stored';
  exception when others then
    if sqlerrm like '%duplicate cards%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
values ('${N}', '${M}', 'Nope', current_date, ${cards});

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
begin
  insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
  values ('${C}', '${E}', 'Fan', current_date, ${cards});
  raise exception 'enthusiast shared a dashboard';
exception when others then
  if sqlerrm like '%enthusiast shared%' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int; stamp text; opened timestamptz; again timestamptz; sid uuid;
begin
  select count(*) into n from public.shared_dashboards;
  if n <> 1 then raise exception 'client sees % shares', n; end if;
  select id, trainer_name into sid, stamp from public.shared_dashboards where client_id = '${C}';
  if stamp is distinct from 'Coach Ana' then raise exception 'client stamp %', stamp; end if;

  update public.shared_dashboards set viewed_at = now() where id = sid;
  select viewed_at into opened from public.shared_dashboards where id = sid;
  if opened is null then raise exception 'opening did not mark the share'; end if;

  update public.shared_dashboards set viewed_at = now() + interval '2 days' where id = sid;
  select viewed_at into again from public.shared_dashboards where id = sid;
  if again is distinct from opened then raise exception 'a second open moved the time'; end if;

  begin
    update public.shared_dashboards set cards = jsonb_build_object(
      'order', jsonb_build_array('plan'),
      'blocks', jsonb_build_object('plan', jsonb_build_object('pct', 0))
    ) where id = sid;
    raise exception 'client edited the frozen cards';
  exception when others then
    if sqlerrm like '%client edited%' then raise; end if;
  end;

  begin
    delete from public.shared_dashboards where id = sid;
    raise exception 'client deleted a share';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards;
  if n <> 0 then raise exception 'stranger sees % shares', n; end if;
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${C}', '${S}', 'Stranger', current_date, ${cards});
    raise exception 'stranger inserted a share';
  exception when others then
    if sqlerrm like '%stranger inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; stamp text;
begin
  update public.shared_dashboards set trainer_name = 'Changed' where client_id = '${C}';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'trainer edited % rows', n; end if;
  select trainer_name into stamp from public.shared_dashboards where client_id = '${C}';
  if stamp is distinct from 'Coach Ana' then raise exception 'stamp changed to %', stamp; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.trainer_clients set ended_at = now() where trainer_id = '${T}' and client_id = '${C}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards;
  if n <> 0 then raise exception 'ended link still sees the share %', n; end if;
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${C}', '${T}', 'Coach Ana', current_date, ${cards});
    raise exception 'ended link inserted a share';
  exception when others then
    if sqlerrm like '%ended link inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards where client_id = '${C}';
  if n <> 1 then raise exception 'client lost the share after the link ended %', n; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from public.profiles where id = '${T}';
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards where trainer_id = '${T}' or client_id = '${T}';
  if n <> 0 then raise exception 'trainer removal left shares %', n; end if;
  select count(*) into n from public.profiles where id = '${C}';
  if n <> 1 then raise exception 'trainer removal removed the client'; end if;
end $$;

insert into public.workout_sessions (
  client_id, local_id, origin, started_at, ended_at, time_zone, local_date, status
) values (
  '${N}', 'ses_keep', 'own', now() - interval '1 hour', now(), 'UTC', current_date, 'completed'
);
insert into public.personal_exercises (user_id, stable_key, name)
values ('${N}', 'ex_row', 'Row');
insert into public.workout_sets (
  session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
  status, logged_by, logged_by_role, display_unit
)
select s.id, '${N}', 0, p.id, 'Row', 'reps', 1, 'completed', '${N}', 'client', 'kg'
from public.workout_sessions s
join public.personal_exercises p on p.user_id = '${N}'
where s.local_id = 'ses_keep';

delete from auth.users where id = '${N}';
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards where client_id = '${N}' or trainer_id = '${N}';
  if n <> 0 then raise exception 'account removal left shares %', n; end if;
  select count(*) into n from public.workout_sessions where client_id = '${N}';
  if n <> 0 then raise exception 'account removal left sessions %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${N}';
  if n <> 0 then raise exception 'account removal left sets %', n; end if;
  select count(*) into n from public.personal_exercises where user_id = '${N}';
  if n <> 0 then raise exception 'account removal left exercises %', n; end if;
end $$;

set role anon;
do $$
begin
  perform count(*) from public.shared_dashboards;
  raise exception 'anon read shares';
exception when insufficient_privilege then
  null;
end $$;
`;

psql('wb_shares_test', assertSql);
console.log('SHARES SQL OK');
