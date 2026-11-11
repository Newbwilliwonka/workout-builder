// RLS for program calendars. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const M = '88888888-8888-4888-8888-888888888888';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const F = '55555555-5555-4555-8555-555555555555';

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

psql('postgres', 'drop database if exists wb_programs_test;\ncreate database wb_programs_test;\n');
psql('wb_programs_test', `
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
  'supabase/migrations/20261111180000_programs.sql',
  'supabase/migrations/20261111223000_program_times.sql',
  'supabase/migrations/20261111223000_program_times.sql'
].forEach(function (file) { psql('wb_programs_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${F}', 'free2@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'master_trainer', email = 'master@example.com' where id = '${M}';
update public.profiles set membership = 'free_client', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'fan@example.com', share_with_trainer = false where id = '${E}';
update public.profiles set membership = 'free_client', email = 'free2@example.com' where id = '${F}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}'),
  ('${M}', '${F}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${E}', false);

do $$
declare n int;
begin
  insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, items, day, presence, starts_at, ends_at)
  values ('${E}', 'pg1', 'wo1', 'Push day', '[{"name":"Press"}]'::jsonb, '2026-11-11', 'solo', '09:00', '10:30');
  select count(*) into n from public.program_entries where owner_id = '${E}' and starts_at = time '09:00' and ends_at = time '10:30';
  if n <> 1 then raise exception 'enthusiast insert %', n; end if;
  begin
    update public.program_entries set ends_at = '08:00' where local_id = 'pg1';
    raise exception 'end before start was stored';
  exception when check_violation then
    null;
  end;
  select count(*) into n from public.program_entries where local_id = 'pg1' and ends_at = time '10:30';
  if n <> 1 then raise exception 'invalid end time stuck'; end if;
  begin
    insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, day)
    values ('${C}', 'nope', 'wo', 'Nope', '2026-11-11');
    raise exception 'enthusiast wrote someone else';
  exception when others then
    if sqlerrm not like '%cannot schedule%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select count(*) into n from public.program_entries;
  if n <> 0 then raise exception 'free client saw another calendar %', n; end if;
  begin
    insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, day)
    values ('${C}', 'own', 'wo', 'Own', '2026-11-12');
    raise exception 'free client scheduled';
  exception when others then
    if sqlerrm not like '%cannot schedule%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.program_entries where owner_id = '${E}';
  if n <> 0 then raise exception 'trainer saw sharing-off calendar %', n; end if;
  begin
    insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, day, presence)
    values ('${E}', 'blocked', 'wo', 'Blocked', '2026-11-12', 'trainer');
    raise exception 'trainer wrote sharing-off calendar';
  exception when others then
    if sqlerrm not like '%cannot schedule%' then raise; end if;
  end;
  insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, items, day, presence)
  values ('${C}', 'ada1', 'wo-ada', 'Sent day', '[]'::jsonb, '2026-11-11', 'trainer');
  select count(*) into n from public.program_entries where owner_id = '${C}';
  if n <> 1 then raise exception 'trainer free-client insert %', n; end if;
end $$;

reset role;
update public.profiles set share_with_trainer = true where id = '${E}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.program_entries where owner_id = '${E}';
  if n <> 1 then raise exception 'trainer should see shared calendar %', n; end if;
  update public.program_entries set day = '2026-11-14', presence = 'trainer' where local_id = 'pg1';
  select count(*) into n from public.program_entries where local_id = 'pg1' and day = '2026-11-14' and presence = 'trainer';
  if n <> 1 then raise exception 'trainer move failed'; end if;
  begin
    update public.program_entries set owner_id = '${C}' where local_id = 'pg1';
    raise exception 'reassign should fail';
  exception when others then
    if sqlerrm not like '%cannot be reassigned%' and sqlerrm not like '%cannot move%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select count(*) into n from public.program_entries where local_id = 'ada1';
  if n <> 1 then raise exception 'free client cannot read own calendar %', n; end if;
  update public.program_entries set presence = 'solo' where local_id = 'ada1';
end $$;
reset role;
do $$
declare presence text;
begin
  select program_entries.presence into presence from public.program_entries where local_id = 'ada1';
  if presence is distinct from 'trainer' then raise exception 'free client changed presence %', presence; end if;
end $$;
set role authenticated;

select set_config('request.jwt.claim.sub', '${M}', false);
do $$
declare n int;
begin
  insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, day, presence)
  values ('${F}', 'master1', 'wo', 'Master day', '2026-11-11', 'solo');
  select count(*) into n from public.program_entries where local_id = 'master1';
  if n <> 1 then raise exception 'master trainer insert %', n; end if;
  select count(*) into n from public.program_entries where owner_id = '${C}';
  if n <> 0 then raise exception 'master saw another trainer client %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
begin
  begin
    insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, day)
    values ('${C}', 'stranger', 'wo', 'Nope', '2026-11-11');
    raise exception 'stranger wrote';
  exception when others then
    if sqlerrm not like '%cannot schedule%' then raise; end if;
  end;
end $$;

reset role;
update public.trainer_clients set ended_at = now() where client_id = '${E}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.program_entries where owner_id = '${E}';
  if n <> 0 then raise exception 'ended link still visible %', n; end if;
  update public.program_entries set day = '2026-11-15' where local_id = 'pg1';
end $$;
reset role;
do $$
declare kept date;
begin
  select day into kept from public.program_entries where local_id = 'pg1';
  if kept is distinct from date '2026-11-14' then raise exception 'ended link changed the day %', kept; end if;
end $$;

set role anon;
do $$
begin
  begin
    perform public.program_is_trainer('${T}');
    raise exception 'anon called program_is_trainer';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.program_linked('${T}', '${C}');
    raise exception 'anon called program_linked';
  exception when insufficient_privilege then
    null;
  end;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  begin
    perform public.program_is_trainer('${T}');
    raise exception 'signed-in user called program_is_trainer';
  exception when insufficient_privilege then
    null;
  end;
  if public.program_can_read('${C}') is distinct from true then
    raise exception 'trainer lost read helper';
  end if;
end $$;
`;

psql('wb_programs_test', assertSql);
psql('postgres', 'drop database if exists wb_programs_test;\n');
console.log('PROGRAMS SQL OK');
