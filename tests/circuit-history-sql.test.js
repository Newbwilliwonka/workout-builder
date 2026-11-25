// Circuit history save: linked clients only, no anon, no duplicate retry.
// Local Postgres only. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '77777777-7777-4777-8777-777777777777';

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

psql('postgres', 'drop database if exists wb_circuit_history_test;\ncreate database wb_circuit_history_test;\n');
psql('wb_circuit_history_test', `
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
  'supabase/migrations/20261125130000_circuit_history.sql'
].forEach(function (file) { psql('wb_circuit_history_test', null, path.join(root, file)); });

const run = JSON.stringify({
  runId: 'run_friday_01',
  name: 'Friday circuit',
  circuitId: 'circ1',
  status: 'completed',
  startedAt: '2026-11-20T15:00:00Z',
  endedAt: '2026-11-20T15:18:00Z',
  timeZone: 'UTC',
  workSec: 40,
  moveSec: 15,
  stations: [
    { id: 'st_squat', name: 'Squat', libraryId: 'squat1' },
    { id: 'st_row', name: 'Row', libraryId: '' }
  ],
  people: [
    { clientId: C, name: 'Ada', rounds: [{ stationId: 'st_squat', workSec: 40 }, { stationId: 'st_row', workSec: 40 }] },
    { name: 'ada@example.com', rounds: [{ stationId: 'st_squat', workSec: 40 }] }
  ]
});

psql('wb_circuit_history_test', `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com');
update public.profiles set membership = 'trainer', access_approved = true where id = '${T}';
update public.profiles set membership = 'free_client', access_approved = true where id = '${C}';
update public.profiles set membership = 'enthusiast', access_approved = true where id = '${E}';
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
select public.circuit_save_run($json$${run}$json$::jsonb);
select public.circuit_save_run($json$${run}$json$::jsonb);
do $$
declare
  sessions int;
  sets int;
  manual text;
begin
  if (select count(*) from public.circuit_runs) <> 1 then
    raise exception 'retry duplicated the run';
  end if;
  select count(*) into sessions from public.workout_sessions where origin = 'circuit';
  if sessions <> 2 then
    raise exception 'expected coach and linked client, got %', sessions;
  end if;
  select count(*) into sets from public.workout_sets where client_id = '${C}';
  if sets <> 2 then
    raise exception 'client rounds were not saved, got %', sets;
  end if;
  if exists (select 1 from public.workout_sessions where client_id = '${E}') then
    raise exception 'a manual person became a session';
  end if;
  select r.manual::text into manual from public.circuit_runs r;
  if position('@' in manual) > 0 then
    raise exception 'an email was stored';
  end if;
  if (select workout_name from public.workout_sessions where client_id = '${T}') <> 'Friday circuit' then
    raise exception 'coach history name was wrong';
  end if;
end $$;

do $$
begin
  begin
    perform public.circuit_save_run($json$${JSON.stringify({
      runId: 'run_unlinked',
      name: 'Nope',
      circuitId: 'circ1',
      status: 'completed',
      startedAt: '2026-11-20T16:00:00Z',
      endedAt: '2026-11-20T16:10:00Z',
      timeZone: 'UTC',
      workSec: 40,
      moveSec: 15,
      stations: [],
      people: [{ clientId: E, name: 'Fan', rounds: [] }]
    })}$json$::jsonb);
    raise exception 'unlinked client was accepted';
  exception when others then
    if SQLERRM like '%unlinked client was accepted%' then raise; end if;
  end;
  if exists (select 1 from public.circuit_runs where run_id = 'run_unlinked') then
    raise exception 'unlinked run was stored';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  begin
    perform public.circuit_save_run('{"runId":"run_client","name":"Nope","startedAt":"2026-11-20T16:00:00Z","endedAt":"2026-11-20T16:10:00Z","people":[]}'::jsonb);
    raise exception 'client saved a circuit';
  exception when others then
    if SQLERRM like '%client saved a circuit%' then raise; end if;
  end;
end $$;

reset role;
set role anon;
do $$
begin
  begin
    perform public.circuit_save_run('{}'::jsonb);
    raise exception 'anon saved a circuit';
  exception when others then
    if SQLERRM like '%anon saved a circuit%' then raise; end if;
  end;
end $$;
`);

console.log('CIRCUIT HISTORY SQL OK');
