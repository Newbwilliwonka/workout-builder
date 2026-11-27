// Master Trainer circuit guard, including an admin who is not on a trainer plan.
// Local Postgres only. Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const name = '20261127140000_master_trainer_circuits.sql';
const sql = fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');

[
  'private.can_build_circuits()',
  "membership = 'master_trainer'",
  'private.is_admin()',
  'Group circuits are part of Master Trainer.',
  'circuits_tier_guard',
  'before insert or update on public.circuits',
  'and private.can_build_circuits()',
  'if not private.can_build_circuits()',
  'grant execute on function public.circuit_save_run(jsonb) to authenticated'
].forEach(function (bit) {
  assert.ok(sql.indexOf(bit) !== -1, bit);
});
assert.ok(sql.indexOf('circuit_save_run_trainer') === -1);
assert.ok(sql.indexOf('program_is_trainer') !== -1, 'guard patch must name the old check');
assert.ok(sql.indexOf("membership not in ('trainer', 'master_trainer')") !== -1, 'save patch must name the old check');

const A = '88888888-8888-4888-8888-888888888888';
const T = '11111111-1111-4111-8111-111111111111';
const M = '99999999-9999-4999-8999-999999999999';
const E = '77777777-7777-4777-8777-777777777777';
const DB = 'wb_circuits_tier_test';

function psql(db, sqlText, file) {
  const args = ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', db];
  const opts = { encoding: 'utf8' };
  if (file) args.push('-f', file);
  else {
    args.push('-f', '-');
    opts.input = sqlText;
  }
  const res = spawnSync('sudo', args, opts);
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
    process.exit(res.status || 1);
  }
  return res.stdout || '';
}

psql('postgres', 'drop database if exists ' + DB + ';\ncreate database ' + DB + ';\n');
psql(DB, `
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`);

[
  'supabase/migrations/20261106150000_profiles.sql',
  'supabase/migrations/20261107160000_invites.sql',
  'supabase/migrations/20261109195000_exercises.sql',
  'supabase/migrations/20261110220000_exercise_search_description.sql',
  'supabase/migrations/20261111120000_messages.sql',
  'supabase/migrations/20261111140000_workout_copies.sql',
  'supabase/migrations/20261111160000_share_own.sql',
  'supabase/migrations/20261111180000_programs.sql',
  'supabase/migrations/20261111223000_program_times.sql',
  'supabase/migrations/20261112120000_trainer_own_program.sql',
  'supabase/migrations/20261112150000_calendar_feeds.sql',
  'supabase/migrations/20261112200000_account_workouts.sql',
  'supabase/migrations/20261115002700_profile_details.sql',
  'supabase/migrations/20261115140000_master_trainer_verification.sql',
  'supabase/migrations/20261115180000_workout_tracking.sql',
  'supabase/migrations/20261116150000_shared_dashboards.sql',
  'supabase/migrations/20261116180000_share_inbox_any_client.sql',
  'supabase/migrations/20261116210000_hide_other_emails.sql',
  'supabase/migrations/20261117010000_trainer_dashboard_layout.sql',
  'supabase/migrations/20261117120000_dashboard_holds_stopwatch.sql',
  'supabase/migrations/20261117180000_invite_only_access.sql',
  'supabase/migrations/20261118190000_trainer_hub.sql',
  'supabase/migrations/20261118210000_trainer_find.sql',
  'supabase/migrations/20261118230000_trainer_near.sql',
  'supabase/migrations/20261118233000_profile_service_location.sql',
  'supabase/migrations/20261123010000_tracking_can_read.sql',
  'supabase/migrations/20261123020000_signup_invite.sql',
  'supabase/migrations/20261123030000_trainer_search_linked_first.sql',
  'supabase/migrations/20261123040000_client_pin.sql',
  'supabase/migrations/20261123050000_exercise_search_best_match.sql',
  'supabase/migrations/20261123200000_circuits.sql',
  'supabase/migrations/20261124200000_circuit_guest_calendar.sql',
  'supabase/migrations/20261124220000_circuit_without_saved_clients.sql',
  'supabase/migrations/20261124233000_placement_invitees.sql',
  'supabase/migrations/20261125030000_client_info.sql',
  'supabase/migrations/20261125040000_nav_badges.sql',
  'supabase/migrations/20261125130000_circuit_history.sql',
  'supabase/migrations/' + name
].forEach(function (file) { psql(DB, null, path.join(root, file)); });

const good = JSON.stringify({
  stations: [
    { id: 'st_squat01', col: 0, row: 0, exercise: { source: 'manual', name: 'Squat', libraryId: null } }
  ],
  order: ['st_squat01'],
  clock: { workSec: 45, moveSec: 15, rounds: 2 }
});
const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const ended = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const run = JSON.stringify({
  runId: 'run_admin_01',
  name: 'Admin class',
  circuitId: 'circ_admin',
  status: 'completed',
  startedAt: started,
  endedAt: ended,
  timeZone: 'UTC',
  workSec: 40,
  moveSec: 15,
  stations: [{ id: 'st_squat', name: 'Squat', libraryId: 'squat1' }],
  people: []
});

psql(DB, `
insert into auth.users (id, email) values
  ('${A}', 'kinisiathletics@gmail.com'),
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${E}', 'fan@example.com');
update public.profiles
  set membership = 'enthusiast', access_approved = true, email = 'kinisiathletics@gmail.com'
  where id = '${A}';
update public.profiles set membership = 'trainer', access_approved = true where id = '${T}';
update public.profiles set membership = 'master_trainer', access_approved = true where id = '${M}';
update public.profiles set membership = 'enthusiast', access_approved = true where id = '${E}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${A}', false);
do $$
begin
  if not private.can_build_circuits() then
    raise exception 'admin on an enthusiast plan cannot build circuits';
  end if;
end $$;
insert into public.circuits (name, data) values ('Admin class', $json$${good}$json$::jsonb);
select public.circuit_save_run($json$${run}$json$::jsonb);

do $$
declare
  n int;
  owner uuid;
begin
  select count(*) into n from public.circuits where owner_id = '${A}';
  select owner_id into owner from public.circuits where name = 'Admin class';
  if n <> 1 or owner <> '${A}' then
    raise exception 'admin insert failed % %', n, owner;
  end if;
  select count(*) into n from public.circuit_runs where trainer_id = '${A}' and run_id = 'run_admin_01';
  if n <> 1 then
    raise exception 'admin run was not saved';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  if private.can_build_circuits() then
    raise exception 'a trainer plan can build circuits';
  end if;
  begin
    insert into public.circuits (name, data) values ('Trainer class', $json$${good}$json$::jsonb);
    raise exception 'trainer inserted a circuit';
  exception when others then
    if SQLERRM not like '%Group circuits are part of Master Trainer.%' then
      if SQLERRM like '%trainer inserted%' then raise; end if;
      raise exception 'trainer insert error was %', SQLERRM;
    end if;
  end;
  begin
    perform public.circuit_save_run($json$${run}$json$::jsonb);
    raise exception 'trainer saved a run';
  exception when others then
    if SQLERRM not like '%Group circuits are part of Master Trainer.%' then
      if SQLERRM like '%trainer saved%' then raise; end if;
      raise exception 'trainer save error was %', SQLERRM;
    end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
begin
  begin
    insert into public.circuits (name, data) values ('Fan class', $json$${good}$json$::jsonb);
    raise exception 'enthusiast inserted a circuit';
  exception when others then
    if SQLERRM like '%enthusiast inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
do $$
begin
  if not private.can_build_circuits() then
    raise exception 'master trainer cannot build circuits';
  end if;
end $$;
insert into public.circuits (name, data) values ('Master class', $json$${good}$json$::jsonb);

reset role;
do $$
declare
  guard_def text := pg_get_functiondef('public.circuits_guard()'::regprocedure);
  save_def text := pg_get_functiondef('public.circuit_save_run(jsonb)'::regprocedure);
  policy text;
begin
  if position('program_is_trainer' in guard_def) > 0 then
    raise exception 'circuits_guard still calls program_is_trainer';
  end if;
  if position('private.can_build_circuits()' in guard_def) = 0 then
    raise exception 'circuits_guard does not use can_build_circuits';
  end if;
  if position('membership not in' in save_def) > 0 then
    raise exception 'circuit_save_run still requires a trainer plan';
  end if;
  if position('circuit_save_run_trainer' in save_def) > 0 then
    raise exception 'circuit_save_run still calls the trainer saver';
  end if;
  if position('private.can_build_circuits()' in save_def) = 0 then
    raise exception 'circuit_save_run does not use can_build_circuits';
  end if;
  select pg_get_expr(polwithcheck, polrelid) into policy
  from pg_policy
  where polrelid = 'public.circuits'::regclass
    and polname = 'circuits_insert';
  if position('can_build_circuits' in policy) = 0 then
    raise exception 'circuits_insert does not use can_build_circuits';
  end if;
  if position('program_is_trainer' in policy) > 0 or position('trainer' in policy) > 0 then
    raise exception 'circuits_insert still requires a trainer plan: %', policy;
  end if;
end $$;
`);

console.log('circuits tier sql ok');
