// Account workouts and trainer access. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const M = '88888888-8888-4888-8888-888888888888';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const O = '99999999-9999-4999-8999-999999999999';
const F = '77777777-7777-4777-8777-777777777777';
const COPY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

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

psql('postgres', 'drop database if exists wb_account_test;\ncreate database wb_account_test;\n');
psql('wb_account_test', `
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
  'supabase/migrations/20261111180000_programs.sql',
  'supabase/migrations/20261111223000_program_times.sql',
  'supabase/migrations/20261112120000_trainer_own_program.sql',
  'supabase/migrations/20261112200000_account_workouts.sql',
  'supabase/migrations/20261112200000_account_workouts.sql'
].forEach(function (file) { psql('wb_account_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${O}', 'other@example.com'),
  ('${F}', 'free2@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'master_trainer', email = 'master@example.com' where id = '${M}';
update public.profiles set membership = 'free_client', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'free_client', email = 'free2@example.com' where id = '${F}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'fan@example.com', share_with_trainer = false where id = '${E}';
update public.profiles set membership = 'trainer', email = 'other@example.com' where id = '${O}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}'),
  ('${M}', '${F}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${E}', false);

-- First copy stores the workout. A second copy of the same id does not duplicate or roll back a newer edit.
do $$
declare result jsonb; n int; name text;
begin
  result := public.account_workout_import(jsonb_build_object(
    'localId', 'wo_leg', 'name', 'Legs', 'items', '[{"name":"Squat","sets":3}]'::jsonb, 'revisedAt', 1000
  ));
  if result->>'created' is distinct from 'true' or result->>'localId' is distinct from 'wo_leg' then
    raise exception 'import %', result;
  end if;
  perform public.account_workout_push(jsonb_build_object(
    'localId', 'wo_leg', 'name', 'Legs later', 'items', '[{"name":"Squat","sets":4}]'::jsonb, 'revisedAt', 5000
  ));
  result := public.account_workout_import(jsonb_build_object(
    'localId', 'wo_leg', 'name', 'Legs', 'items', '[{"name":"Squat","sets":3}]'::jsonb, 'revisedAt', 1000
  ));
  if result->>'created' is distinct from 'false' or result->>'name' is distinct from 'Legs later' then
    raise exception 'second import overwrote %', result;
  end if;
  select count(*) into n from public.account_workouts where owner_id = '${E}' and local_id = 'wo_leg';
  if n <> 1 then raise exception 'duplicate legs %', n; end if;
end $$;

-- A failed row does not remove the row that already copied.
do $$
declare n int;
begin
  begin
    perform public.account_workout_import(jsonb_build_object(
      'localId', 'wo_bad', 'name', '', 'items', '[]'::jsonb, 'revisedAt', 1000
    ));
    raise exception 'blank name should fail';
  exception when others then
    if sqlerrm not like '%workout name%' then raise; end if;
  end;
  select count(*) into n from public.account_workouts where owner_id = '${E}' and local_id = 'wo_leg';
  if n <> 1 then raise exception 'failed copy removed legs %', n; end if;
  perform public.account_workout_import(jsonb_build_object(
    'localId', 'wo_push', 'name', 'Push', 'items', '[{"name":"Press","sets":3}]'::jsonb, 'revisedAt', 2000
  ));
  select count(*) into n from public.account_workouts where owner_id = '${E}' and deleted_at is null;
  if n <> 2 then raise exception 'push missing %', n; end if;
end $$;

-- An older edit does not win.
do $$
declare result jsonb;
begin
  result := public.account_workout_push(jsonb_build_object(
    'localId', 'wo_leg', 'name', 'Legs old', 'items', '[]'::jsonb, 'revisedAt', 1000
  ));
  if result->>'name' is distinct from 'Legs later' then raise exception 'older won %', result; end if;
end $$;

-- The program calendar still points at the same local id.
do $$
declare n int; ref text;
begin
  insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, items, day, presence)
  values ('${E}', 'pg1', 'wo_leg', 'Legs later', '[{"name":"Squat","sets":4}]'::jsonb, '2026-11-12', 'solo');
  select count(*), min(workout_local_id) into n, ref
    from public.program_entries
    where owner_id = '${E}' and workout_local_id = 'wo_leg';
  if n <> 1 or ref is distinct from 'wo_leg' then raise exception 'program ref % %', n, ref; end if;
end $$;

-- Six live workouts is the plan cap. A seventh new save is rejected. The two already stored stay.
do $$
declare i int; n int;
begin
  for i in 3..6 loop
    perform public.account_workout_push(jsonb_build_object(
      'localId', 'wo_' || i, 'name', 'Day ' || i, 'items', '[]'::jsonb, 'revisedAt', 3000 + i
    ));
  end loop;
  select count(*) into n from public.account_workouts where owner_id = '${E}' and deleted_at is null;
  if n <> 6 then raise exception 'cap setup %', n; end if;
  begin
    perform public.account_workout_push(jsonb_build_object(
      'localId', 'wo_7', 'name', 'Day 7', 'items', '[]'::jsonb, 'revisedAt', 9000
    ));
    raise exception 'seventh should fail';
  exception when others then
    if sqlerrm not like '%up to 6%' then raise; end if;
  end;
  select count(*) into n from public.account_workouts where owner_id = '${E}' and local_id = 'wo_7';
  if n <> 0 then raise exception 'seventh stored'; end if;
  perform public.account_workout_import(jsonb_build_object(
    'localId', 'wo_legacy', 'name', 'Already built', 'items', '[]'::jsonb, 'revisedAt', 4000
  ));
  select count(*) into n from public.account_workouts where owner_id = '${E}' and local_id = 'wo_legacy' and deleted_at is null;
  if n <> 1 then raise exception 'legacy copy dropped'; end if;
end $$;

-- A later save is a new request, so the one-time import flag is gone and the cap holds.
do $$
declare n int;
begin
  begin
    perform public.account_workout_push(jsonb_build_object(
      'localId', 'wo_after', 'name', 'After the copy', 'items', '[]'::jsonb, 'revisedAt', 5000
    ));
    raise exception 'new save should still stop at 6';
  exception when others then
    if sqlerrm not like '%up to 6%' then raise; end if;
  end;
  delete from public.account_workouts where owner_id = '${E}' and local_id = 'wo_legacy';
  select count(*) into n from public.account_workouts where owner_id = '${E}' and deleted_at is null;
  if n <> 6 then raise exception 'cap left %', n; end if;
end $$;

-- Sharing off: the linked trainer cannot see or change the Enthusiast's own workouts.
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; info jsonb;
begin
  select count(*) into n from public.account_workouts where owner_id = '${E}';
  if n <> 0 then raise exception 'trainer saw shared-off workouts %', n; end if;
  info := public.account_client_workouts('${E}');
  if info->>'permission' is distinct from 'hidden' or info->'workouts' <> '[]'::jsonb then
    raise exception 'hidden info %', info;
  end if;
  begin
    perform public.account_client_save('${E}', jsonb_build_object(
      'localId', 'wo_leg', 'name', 'Hack', 'items', '[]'::jsonb, 'revisedAt', 99999
    ));
    raise exception 'trainer edited an enthusiast workout';
  exception when others then
    if sqlerrm not like '%only view%' then raise; end if;
  end;
  update public.account_workouts set name = 'Hack' where owner_id = '${E}';
  if found then raise exception 'trainer updated enthusiast row'; end if;
  delete from public.account_workouts where owner_id = '${E}';
  if found then raise exception 'trainer deleted enthusiast row'; end if;
end $$;

-- Sharing on: view and run, still no edit or delete.
select set_config('request.jwt.claim.sub', '${E}', false);
select public.share_set(true);
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int; info jsonb; item text;
begin
  select count(*) into n from public.account_workouts where owner_id = '${E}';
  if n <> 6 then raise exception 'trainer read %', n; end if;
  info := public.account_client_workouts('${E}');
  if info->>'permission' is distinct from 'view' then raise exception 'view perm %', info; end if;
  select w.items::text into item from public.account_workouts w where w.local_id = 'wo_leg';
  if position('Squat' in item) = 0 then raise exception 'items %', item; end if;
  update public.account_workouts set name = 'Hack' where owner_id = '${E}';
  if found then raise exception 'shared trainer updated'; end if;
  delete from public.account_workouts where owner_id = '${E}';
  if found then raise exception 'shared trainer deleted'; end if;
  begin
    insert into public.account_workouts (owner_id, local_id, name, items)
    values ('${E}', 'wo_hack', 'Hack', '[]'::jsonb);
    raise exception 'trainer insert should fail';
  exception when others then
    if sqlerrm not like '%cannot save%' and sqlerrm not like '%row-level security%' and sqlerrm not like '%only view%' then raise; end if;
  end;
end $$;

-- A stranger, another trainer, and the free client cannot see the Enthusiast's workouts.
select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.account_workouts;
  if n <> 0 then raise exception 'stranger saw %', n; end if;
  begin
    perform public.account_client_workouts('${E}');
    raise exception 'stranger client read';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${O}', false);
do $$
declare n int;
begin
  select count(*) into n from public.account_workouts where owner_id = '${E}';
  if n <> 0 then raise exception 'other trainer saw %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select count(*) into n from public.account_workouts where owner_id = '${E}';
  if n <> 0 then raise exception 'free client saw enthusiast %', n; end if;
  perform public.account_workout_import(jsonb_build_object(
    'localId', 'wo_ada', 'name', 'Ada day', 'items', '[{"name":"Row","sets":3}]'::jsonb, 'revisedAt', 1000
  ));
end $$;

-- Free Client workouts: the linked trainer can view, run, and edit.
-- A Master Trainer uses the same rule on their own linked client.
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare info jsonb; result jsonb; n int;
begin
  info := public.account_client_workouts('${C}');
  if info->>'permission' is distinct from 'edit' then raise exception 'free perm %', info; end if;
  if position('Ada day' in info::text) = 0 then raise exception 'free list %', info; end if;
  result := public.account_client_save('${C}', jsonb_build_object(
    'localId', 'wo_ada', 'name', 'Ada day edited', 'items', '[{"name":"Row","sets":5}]'::jsonb, 'revisedAt', 4000
  ));
  if result->>'name' is distinct from 'Ada day edited' then raise exception 'edit %', result; end if;
  result := public.account_client_save('${C}', jsonb_build_object(
    'localId', 'wo_ada', 'name', 'Ada day old', 'items', '[]'::jsonb, 'revisedAt', 1000
  ));
  if result->>'name' is distinct from 'Ada day edited' then raise exception 'older client edit won %', result; end if;
  select count(*) into n from public.account_workouts where owner_id = '${C}' and local_id = 'wo_ada';
  if n <> 1 then raise exception 'free duplicate %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${F}', false);
do $$
begin
  perform public.account_workout_import(jsonb_build_object(
    'localId', 'wo_free2', 'name', 'Second day', 'items', '[{"name":"Lunge","sets":2}]'::jsonb, 'revisedAt', 1000
  ));
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
do $$
declare info jsonb; result jsonb;
begin
  info := public.account_client_workouts('${F}');
  if info->>'permission' is distinct from 'edit' or position('Second day' in info::text) = 0 then
    raise exception 'master %', info;
  end if;
  result := public.account_client_save('${F}', jsonb_build_object(
    'localId', 'wo_free2', 'name', 'Second day edited', 'items', '[{"name":"Lunge","sets":4}]'::jsonb, 'revisedAt', 3000
  ));
  if result->>'name' is distinct from 'Second day edited' then raise exception 'master edit %', result; end if;
  if (select count(*) from public.account_workouts where owner_id = '${C}') <> 0 then
    raise exception 'master saw another trainer client';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare result jsonb;
begin
  result := public.account_workout_pull();
  if position('Ada day edited' in result::text) = 0 or position('sets": 5' in result::text) = 0 and position('"sets":5' in result::text) = 0 then
    raise exception 'client did not see trainer edit %', result;
  end if;
end $$;

-- Workouts a trainer sent: the trainer can view and edit. The enthusiast still can. A free client still cannot edit their copy.
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare sent jsonb; saved jsonb;
begin
  perform public.workout_send(
    jsonb_build_array(jsonb_build_object('id', '${COPY}', 'clientId', '${E}')),
    'Friday',
    '[{"name":"Squat","sets":3}]'::jsonb,
    'wo_leg'
  );
  sent := public.workout_sent('${E}');
  if position('Friday' in sent::text) = 0 then raise exception 'sent %', sent; end if;
  saved := public.workout_trainer_save('${COPY}', 'Friday edited', '[{"name":"Squat","sets":6}]'::jsonb);
  if saved->>'name' is distinct from 'Friday edited' then raise exception 'trainer save %', saved; end if;
end $$;

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare mine jsonb;
begin
  mine := public.workout_mine();
  if position('Friday edited' in mine::text) = 0 then raise exception 'enthusiast copy %', mine; end if;
  perform public.workout_save('${COPY}', 'Friday mine', '[{"name":"Squat","sets":2}]'::jsonb);
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare sent jsonb;
begin
  sent := public.workout_sent('${E}');
  if position('Friday mine' in sent::text) = 0 then raise exception 'trainer missed enthusiast edit %', sent; end if;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_copies;
  if n <> 0 then raise exception 'stranger saw a copy %', n; end if;
  begin
    perform public.workout_trainer_save('${COPY}', 'Stolen', '[]'::jsonb);
    raise exception 'stranger saved a copy';
  exception when others then
    if sqlerrm not like '%not found%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  begin
    perform public.workout_save('${COPY}', 'Stolen', '[]'::jsonb);
    raise exception 'free client edited a sent copy';
  exception when others then
    if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
  end;
end $$;

-- Ending the link hides both the Enthusiast's own workouts and the sent copy.
select set_config('request.jwt.claim.sub', '${T}', false);
select public.invite_end('${E}'::uuid);
do $$
declare n int;
begin
  select count(*) into n from public.account_workouts where owner_id = '${E}';
  if n <> 0 then raise exception 'ended link still sees workouts %', n; end if;
  select count(*) into n from public.workout_copies where owner_id = '${E}';
  if n <> 0 then raise exception 'ended link still sees copies %', n; end if;
  begin
    perform public.workout_trainer_save('${COPY}', 'After', '[]'::jsonb);
    raise exception 'ended trainer saved';
  exception when others then
    if sqlerrm not like '%not found%' then raise; end if;
  end;
  begin
    perform public.account_client_workouts('${E}');
    raise exception 'ended client read';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
end $$;

-- The Enthusiast still has the program row and the workout.
select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare n int; ref text;
begin
  select count(*) into n from public.account_workouts where local_id = 'wo_leg' and name = 'Legs later';
  if n <> 1 then raise exception 'owner lost legs %', n; end if;
  select workout_local_id into ref from public.program_entries where local_id = 'pg1';
  if ref is distinct from 'wo_leg' then raise exception 'program id changed %', ref; end if;
end $$;

reset role;
set role anon;
do $$
begin
  perform 1 from public.account_workouts;
  raise exception 'anon read should fail';
exception when insufficient_privilege then
  null;
end $$;
`;

psql('wb_account_test', assertSql);
console.log('ACCOUNT WORKOUTS SQL OK');
