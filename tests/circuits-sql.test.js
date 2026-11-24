// Owner-only circuits, trainer insert, and the jsonb guard.
// Local Postgres only. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const M = '33333333-3333-4333-8333-333333333333';
const E = '77777777-7777-4777-8777-777777777777';
const C = '22222222-2222-4222-8222-222222222222';
const S = '44444444-4444-4444-8444-444444444444';
const N = '55555555-5555-4555-8555-555555555555';
const U = '66666666-6666-4666-8666-666666666666';

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

psql('postgres', 'drop database if exists wb_circuits_test;\ncreate database wb_circuits_test;\n');
psql('wb_circuits_test', `
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
  'supabase/migrations/20261123200000_circuits.sql',
  'supabase/migrations/20261123200000_circuits.sql',
  'supabase/migrations/20261124220000_circuit_without_saved_clients.sql',
  'supabase/migrations/20261124200000_circuit_guest_calendar.sql'
].forEach(function (file) { psql('wb_circuits_test', null, path.join(root, file)); });

const good = JSON.stringify({
  stations: [
    { id: 'st_squat01', col: 0, row: 0, exercise: { source: 'manual', name: 'Squat', libraryId: null } },
    { id: 'st_lunge01', col: 1, row: 0, exercise: { source: 'library', name: 'Lunge', libraryId: 'lunge1' } }
  ],
  order: ['st_squat01', 'st_lunge01'],
  clients: [
    { source: 'linked', id: C, name: 'Ada' },
    { source: 'manual', name: 'Guest' }
  ],
  clock: { workSec: 45, moveSec: 15, rounds: 2 }
});

psql('wb_circuits_test', `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${E}', 'fan@example.com'),
  ('${C}', 'ada@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${N}', 'plan@example.com'),
  ('${U}', 'waiting@example.com');
update public.profiles set membership = 'trainer', access_approved = true, email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'master_trainer', access_approved = true where id = '${M}';
update public.profiles set membership = 'enthusiast', access_approved = true where id = '${E}';
update public.profiles set membership = 'free_client', access_approved = true where id = '${C}';
update public.profiles set membership = 'trainer', access_approved = true where id = '${S}';
update public.profiles set membership = 'none', intended_plan = 'trainer', access_approved = true where id = '${N}';
update public.profiles set membership = 'trainer', access_approved = false where id = '${U}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
insert into public.circuits (name, data) values ('Saturday class', $json$${good}$json$::jsonb);
do $$
declare
  n int;
  owner uuid;
begin
  select count(*) into n from public.circuits;
  select owner_id into owner from public.circuits limit 1;
  if n <> 1 or owner <> '${T}' then
    raise exception 'trainer insert failed % %', n, owner;
  end if;
  if (select data->'clock'->>'moveSec' from public.circuits) is distinct from '15' then
    raise exception 'move time was not stored';
  end if;
  if (select data ? 'clients' from public.circuits) then
    raise exception 'clients were stored on the circuit';
  end if;
  if (select updated_at from public.circuits) is null then
    raise exception 'updated_at was not set';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.circuits (name, data) values ('Master class', $json$${good}$json$::jsonb);

select set_config('request.jwt.claim.sub', '${N}', false);
insert into public.circuits (name, data) values ('Planned class', $json$${good}$json$::jsonb);

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
begin
  begin
    insert into public.circuits (name, data) values ('Nope', $json$${good}$json$::jsonb);
    raise exception 'enthusiast inserted a circuit';
  exception when others then
    if SQLERRM like '%enthusiast inserted%' then raise; end if;
  end;
  if (select count(*) from public.circuits) <> 0 then
    raise exception 'enthusiast can read a circuit';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  begin
    insert into public.circuits (name, data) values ('Nope', $json$${good}$json$::jsonb);
    raise exception 'client inserted a circuit';
  exception when others then
    if SQLERRM like '%client inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${U}', false);
do $$
begin
  begin
    insert into public.circuits (name, data) values ('Nope', $json$${good}$json$::jsonb);
    raise exception 'unapproved trainer inserted a circuit';
  exception when others then
    if SQLERRM like '%unapproved trainer inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
begin
  if (select count(*) from public.circuits) <> 0 then
    raise exception 'another trainer can see a circuit';
  end if;
  begin
    update public.circuits set name = 'Stolen' where owner_id = '${T}';
  exception when others then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare
  before_at timestamptz;
begin
  if (select name from public.circuits where owner_id = '${T}') is distinct from 'Saturday class' then
    raise exception 'another trainer renamed the circuit';
  end if;
  select updated_at into before_at from public.circuits where owner_id = '${T}';
  perform pg_sleep(0.01);
  update public.circuits set name = 'Saturday circuit' where owner_id = '${T}';
  if (select name from public.circuits where owner_id = '${T}') is distinct from 'Saturday circuit' then
    raise exception 'owner could not rename';
  end if;
  if (select updated_at from public.circuits where owner_id = '${T}') <= before_at then
    raise exception 'updated_at did not move';
  end if;
  begin
    update public.circuits set owner_id = '${S}' where owner_id = '${T}';
    raise exception 'owner was reassigned';
  exception when others then
    if SQLERRM like '%owner was reassigned%' then raise; end if;
    if SQLERRM not like '%cannot be reassigned%' then raise; end if;
  end;
  begin
    insert into public.circuits (name, data) values ('Open loop', jsonb_set($json$${good}$json$::jsonb, '{order}', '["st_squat01"]'::jsonb));
    raise exception 'open loop saved';
  exception when others then
    if SQLERRM like '%open loop saved%' then raise; end if;
    if SQLERRM not like '%close the loop%' then raise; end if;
  end;
  begin
    insert into public.circuits (name, data) values ('Weights', $json$${good}$json$::jsonb || '{"weight":40}'::jsonb);
    raise exception 'weight saved';
  exception when others then
    if SQLERRM like '%weight saved%' then raise; end if;
    if SQLERRM not like '%reps and weight%' and SQLERRM not like '%could not be saved%' then raise; end if;
  end;
  begin
    insert into public.circuits (name, data) values ('Unnamed', jsonb_set($json$${good}$json$::jsonb, '{stations,0,exercise}', 'null'::jsonb));
    raise exception 'unnamed saved';
  exception when others then
    if SQLERRM like '%unnamed saved%' then raise; end if;
    if SQLERRM not like '%Name every station before saving.%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
delete from public.circuits where owner_id = '${T}';
do $$
begin
  if (select count(*) from public.circuits where owner_id = '${T}') <> 0 then
    raise exception 'owner could not delete';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.circuits (id, owner_id, name, data)
values ('88888888-8888-4888-8888-888888888888', '${T}', 'Saturday circuit', $json$${good}$json$::jsonb);
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');
insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, items, day, presence, starts_at, ends_at)
values (
  '${T}', 'pg-invite', '88888888-8888-4888-8888-888888888888', 'Saturday circuit',
  '[{"source":"circuit","circuitId":"88888888-8888-4888-8888-888888888888"}]'::jsonb,
  current_date, 'trainer', '09:00', '10:00'
);
insert into public.circuit_placement_invites (trainer_id, placement_id, client_id)
values ('${T}', 'pg-invite', '${C}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  if (select count(*) from public.circuit_guest_placements('${C}')) <> 1 then
    raise exception 'invited client did not see the placement';
  end if;
  if (select trainer_name from public.circuit_guest_placements('${C}')) is distinct from 'Trainer' then
    raise exception 'trainer name leaked an email or the wrong label';
  end if;
  if (select count(*) from public.circuit_placement_invites where client_id = '${C}') <> 1 then
    raise exception 'invitee could not read their own invite';
  end if;
  if (select count(*) from public.circuit_placement_invites where client_id <> '${C}') <> 0 then
    raise exception 'invitee read someone else';
  end if;
  begin
    insert into public.circuit_placement_invites (trainer_id, placement_id, client_id)
    values ('${C}', 'pg-invite', '${E}');
    raise exception 'client inserted an invite';
  exception when others then
    if SQLERRM like '%client inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
begin
  if (select count(*) from public.circuit_guest_placements('${C}')) <> 0 then
    raise exception 'another trainer saw the placement';
  end if;
  if (select count(*) from public.circuit_placement_invites) <> 0 then
    raise exception 'another trainer read the invites';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  if (select count(*) from public.circuit_guest_placements('${C}')) <> 1 then
    raise exception 'owning trainer did not see their invited placement';
  end if;
  perform public.circuit_placement_invites_save('pg-invite', array['${C}']::uuid[]);
  if (select count(*) from public.circuit_placement_invites where placement_id = 'pg-invite' and client_id = '${C}') <> 1 then
    raise exception 'atomic save dropped the linked invite';
  end if;
  begin
    perform public.circuit_placement_invites_save('pg-invite', array['${E}']::uuid[]);
    raise exception 'unlinked invite saved';
  exception when others then
    if SQLERRM like '%unlinked invite saved%' then raise; end if;
    if SQLERRM not like '%Invite only linked clients%' then raise; end if;
  end;
  if (select count(*) from public.circuit_placement_invites where placement_id = 'pg-invite' and client_id = '${C}') <> 1 then
    raise exception 'failed save removed the existing invite';
  end if;
  begin
    insert into public.circuit_placement_invites (trainer_id, placement_id, client_id)
    values ('${T}', 'pg-invite', '${E}');
    raise exception 'unlinked row inserted';
  exception when others then
    if SQLERRM like '%unlinked row inserted%' then raise; end if;
  end;
end $$;

reset role;
do $$
begin
  if (select count(*) from public.account_workouts) <> 0 then
    raise exception 'circuits wrote a workout';
  end if;
end $$;

set role anon;
do $$
begin
  begin
    perform 1 from public.circuits;
    raise exception 'anon read circuits';
  exception when insufficient_privilege then null;
  end;
end $$;
`);

console.log('CIRCUITS SQL OK');
