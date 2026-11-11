// RLS for an Enthusiast's own workouts and tracking. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const F = '55555555-5555-4555-8555-555555555555';
const N = '66666666-6666-4666-8666-666666666666';
const G = '77777777-7777-4777-8777-777777777777';

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

psql('postgres', 'drop database if exists wb_share_test;\ncreate database wb_share_test;\n');
psql('wb_share_test', `
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
  'supabase/migrations/20261111120000_messages.sql',
  'supabase/migrations/20261111140000_workout_copies.sql',
  'supabase/migrations/20261111160000_share_own.sql',
  'supabase/migrations/20261111160000_share_own.sql'
].forEach(function (file) { psql('wb_share_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${F}', 'later@example.com'),
  ('${N}', 'new@example.com'),
  ('${G}', 'glad@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'free_client', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'fan@example.com' where id = '${E}';
update public.profiles set membership = 'none', intended_plan = 'enthusiast', email = 'later@example.com' where id = '${F}';
update public.profiles set membership = 'none', intended_plan = 'enthusiast', email = 'glad@example.com' where id = '${G}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}');
insert into public.invites (trainer_id, code, expires_at) values
  ('${T}', 'ABCD2345', now() + interval '2 hours'),
  ('${T}', 'EFGH6789', now() + interval '2 hours'),
  ('${T}', 'JKLMNPQR', now() + interval '2 hours');

-- Sharing starts off. The flag is a real false, not a missing value.
do $$
declare flag boolean;
begin
  select share_with_trainer into flag from public.profiles where id = '${E}';
  if flag is distinct from false then raise exception 'default flag %', flag; end if;
  select share_with_trainer into flag from public.profiles where id = '${C}';
  if flag is distinct from false then raise exception 'free client flag %', flag; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${E}', false);

do $$
declare setting jsonb; pushed jsonb; n int;
begin
  setting := public.share_setting();
  if setting->>'on' is distinct from 'false' then raise exception 'setting %', setting; end if;
  if setting->>'enthusiast' is distinct from 'true' then raise exception 'not enthusiast %', setting; end if;
  if setting->>'linked' is distinct from 'true' then raise exception 'not linked %', setting; end if;
  pushed := public.share_push(
    jsonb_build_array(
      jsonb_build_object('localId', 'wo_sat', 'name', 'Saturday easy', 'items', '[{"name":"Squat","sets":3},{"name":"Plank","sets":2}]'::jsonb),
      jsonb_build_object('localId', 'wo_extra', 'name', 'Extra day', 'items', '[]'::jsonb)
    ),
    jsonb_build_array(jsonb_build_object(
      'localId', 'ses_1',
      'workoutId', 'wo_sat',
      'workoutName', 'Saturday easy',
      'startedAt', '1760000000000',
      'endedAt', '1760001000000',
      'results', '[{"name":"Squat","set":1,"of":3,"reps":8,"weight":135,"unit":"lb","logged":true}]'::jsonb
    ))
  );
  if (pushed->>'workouts')::int <> 2 or (pushed->>'sessions')::int <> 1 then
    raise exception 'push %', pushed;
  end if;
  select count(*) into n from public.own_workouts where owner_id = '${E}';
  if n <> 2 then raise exception 'owner rows %', n; end if;
  begin
    perform public.share_push(null, '[]'::jsonb);
    raise exception 'null push should fail';
  exception when others then
    if sqlerrm not like '%Could not read%' then raise; end if;
  end;
  select count(*) into n from public.own_workouts where owner_id = '${E}';
  if n <> 2 then raise exception 'null push deleted rows %', n; end if;
end $$;

-- Off: the trainer's select is empty. Status does not include the workouts.
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; status jsonb;
begin
  select count(*) into n from public.own_workouts;
  if n <> 0 then raise exception 'trainer saw workouts while off %', n; end if;
  select count(*) into n from public.own_sessions;
  if n <> 0 then raise exception 'trainer saw sessions while off %', n; end if;
  status := public.share_status('${E}');
  if status->>'shared' is distinct from 'false' then raise exception 'status %', status; end if;
  if status->>'plan' is distinct from 'Enthusiast' then raise exception 'plan %', status; end if;
  if status ? 'workouts' or status ? 'sessions' or position('Saturday' in status::text) <> 0 or position('Squat' in status::text) <> 0 then
    raise exception 'status leaked rows %', status;
  end if;
  status := public.share_status('${C}');
  if status->>'shared' is distinct from 'false' or status->>'enthusiast' is distinct from 'false' or status->>'plan' is distinct from 'Free Client' then
    raise exception 'free status %', status;
  end if;
  if public.message_threads()->>'role' is distinct from 'trainer' then
    raise exception 'messages changed';
  end if;
  if public.workout_mine() <> '[]'::jsonb then
    raise exception 'workout copies changed %', public.workout_mine();
  end if;
end $$;

-- On: the trainer can read and cannot write.
select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare setting jsonb;
begin
  setting := public.share_set(true);
  if setting->>'on' is distinct from 'true' then raise exception 'set %', setting; end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; body text; item_text text;
begin
  select count(*) into n from public.own_workouts;
  if n <> 2 then raise exception 'trainer read % workouts', n; end if;
  select count(*) into n from public.own_sessions;
  if n <> 1 then raise exception 'trainer read % sessions', n; end if;
  select w.items::text into item_text from public.own_workouts w where w.local_id = 'wo_sat';
  if position('Squat' in item_text) = 0 or position('Plank' in item_text) = 0 then
    raise exception 'items %', item_text;
  end if;
  select s.results::text into body from public.own_sessions s where s.local_id = 'ses_1';
  if position('Squat' in body) = 0 or position('135' in body) = 0 then
    raise exception 'results %', body;
  end if;
  update public.own_workouts set name = 'Hack' where owner_id = '${E}';
  if found then raise exception 'trainer updated a workout'; end if;
  delete from public.own_sessions where owner_id = '${E}';
  if found then raise exception 'trainer deleted a session'; end if;
  begin
    insert into public.own_workouts (owner_id, local_id, name, items)
    values ('${E}', 'hack', 'Hack', '[]'::jsonb);
    raise exception 'trainer insert should fail';
  exception when others then
    if sqlerrm not like '%only view%' and sqlerrm not like '%row-level security%' then raise; end if;
  end;
  begin
    perform public.share_set(false);
    raise exception 'trainer set share';
  exception when others then
    if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
  end;
  begin
    perform public.share_push('[]'::jsonb, '[]'::jsonb);
    raise exception 'trainer push should fail';
  exception when others then
    if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
  end;
end $$;

-- Replacing the enthusiast's list removes the workout they deleted locally.
select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare n int;
begin
  perform public.share_push(
    jsonb_build_array(jsonb_build_object('localId', 'wo_sat', 'name', 'Saturday easy', 'items', '[{"name":"Squat","sets":3}]'::jsonb)),
    jsonb_build_array(jsonb_build_object(
      'localId', 'ses_1', 'workoutId', 'wo_sat', 'workoutName', 'Saturday easy',
      'endedAt', '1760001000000',
      'results', '[{"name":"Squat","set":1,"of":3,"reps":8,"weight":135,"unit":"lb","logged":true},{"name":"Squat","set":2,"of":3,"reps":8,"weight":135,"unit":"lb","logged":true}]'::jsonb
    ))
  );
  select count(*) into n from public.own_workouts where owner_id = '${E}' and local_id = 'wo_extra';
  if n <> 0 then raise exception 'removed workout stayed'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; body text;
begin
  select count(*) into n from public.own_workouts;
  if n <> 1 then raise exception 'trainer still sees %', n; end if;
  select s.results::text into body from public.own_sessions s;
  if position('set":2' in body) = 0 and position('"set": 2' in body) = 0 and position('"set":2' in body) = 0 then
    raise exception 'second set missing %', body;
  end if;
  if position('Extra' in coalesce((select string_agg(name, ',') from public.own_workouts), '')) <> 0 then
    raise exception 'deleted workout still visible';
  end if;
end $$;

-- Off again takes effect on the next read.
select set_config('request.jwt.claim.sub', '${E}', false);
select public.share_set(false);
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.own_workouts;
  if n <> 0 then raise exception 'off did not hide workouts %', n; end if;
  select count(*) into n from public.own_sessions;
  if n <> 0 then raise exception 'off did not hide sessions %', n; end if;
end $$;

-- The owner still sees their own rows while the trainer cannot.
select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare n int;
begin
  select count(*) into n from public.own_workouts;
  if n <> 1 then raise exception 'owner lost a workout %', n; end if;
  select count(*) into n from public.own_sessions;
  if n <> 1 then raise exception 'owner lost a session %', n; end if;
end $$;

-- A stranger, the free client, and a turned-on free-client flag still reveal nothing.
select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.own_workouts;
  if n <> 0 then raise exception 'stranger saw %', n; end if;
  begin
    perform public.share_status('${E}');
    raise exception 'stranger status should fail';
  exception when others then
    if sqlerrm not like '%Only a trainer%' then raise; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set share_with_trainer = true where id = '${C}';
insert into public.own_workouts (owner_id, local_id, name, items)
values ('${C}', 'free_wo', 'Private free', '[{"name":"Secret"}]'::jsonb);

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.own_workouts where owner_id = '${C}';
  if n <> 0 then raise exception 'trainer saw a free client workout'; end if;
  if public.share_status('${C}')->>'shared' is distinct from 'false' then
    raise exception 'free client reported shared';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare flag boolean; n int;
begin
  begin
    perform public.share_set(true);
    raise exception 'free client set share';
  exception when others then
    if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
  end;
  select share_with_trainer into flag from public.profiles where id = '${C}';
  if flag is distinct from true then raise exception 'free client flag changed %', flag; end if;
  select count(*) into n from public.own_workouts where owner_id = '${E}';
  if n <> 0 then raise exception 'free client saw enthusiast rows %', n; end if;
end $$;

-- Ending the link drops the trainer's access even while the flag stays on.
select set_config('request.jwt.claim.sub', '${E}', false);
select public.share_set(true);
select set_config('request.jwt.claim.sub', '${T}', false);
select public.invite_end('${E}'::uuid);
do $$
declare n int;
begin
  select count(*) into n from public.own_workouts;
  if n <> 0 then raise exception 'ended link still visible %', n; end if;
  begin
    perform public.share_status('${E}');
    raise exception 'ended status should fail';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
end $$;

-- Redeem stores the Enthusiast's choice and leaves a Free Client's flag alone.
-- A linked Enthusiast is on the trainer's roster.
select set_config('request.jwt.claim.sub', '${F}', false);
do $$
declare result jsonb; flag boolean; roster jsonb;
begin
  result := public.invite_redeem('ABCD2345', false);
  if result->>'message' not like '%Enthusiast%' then raise exception 'redeem %', result; end if;
  select share_with_trainer into flag from public.profiles where id = '${F}';
  if flag is distinct from false then raise exception 'unchecked stored %', flag; end if;
  if (select membership from public.profiles where id = '${F}') is distinct from 'none' then
    raise exception 'enthusiast membership changed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare roster jsonb; plan text; n int;
begin
  roster := public.invite_roster();
  if (roster->>'clientCount')::int < 2 then raise exception 'roster %', roster; end if;
  select elem->>'plan' into plan from jsonb_array_elements(roster->'clients') elem
    where elem->>'id' = '${F}';
  if plan is distinct from 'Enthusiast' then raise exception 'enthusiast not a client %', roster; end if;
  select count(*) into n from public.own_workouts;
  if n <> 0 then raise exception 'new client leaked workouts %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${N}', false);
do $$
declare flag boolean;
begin
  perform public.invite_redeem('EFGH6789', true);
  if (select membership from public.profiles where id = '${N}') is distinct from 'free_client' then
    raise exception 'did not become free client';
  end if;
  select share_with_trainer into flag from public.profiles where id = '${N}';
  if flag is distinct from false then raise exception 'free redeem stored share %', flag; end if;
end $$;

select set_config('request.jwt.claim.sub', '${G}', false);
do $$
declare flag boolean;
begin
  perform public.invite_redeem('JKLMNPQR');
  select share_with_trainer into flag from public.profiles where id = '${G}';
  if flag is distinct from true then raise exception 'default redeem %', flag; end if;
  if (select intended_plan from public.profiles where id = '${G}') is distinct from 'enthusiast' then
    raise exception 'plan changed';
  end if;
end $$;

reset role;
set role anon;
do $$
begin
  perform 1 from public.own_workouts;
  raise exception 'anon read should fail';
exception when insufficient_privilege then
  null;
end $$;
`;

psql('wb_share_test', assertSql);
psql('wb_share_test', null, path.join(root, 'supabase/migrations/20261111160000_share_own.sql'));
console.log('SHARING SQL OK');
