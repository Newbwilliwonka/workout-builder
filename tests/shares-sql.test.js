// Shared dashboard access. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const C = '22222222-2222-4222-8222-222222222222';
const T = '11111111-1111-4111-8111-111111111111';
const M = '33333333-3333-4333-8333-333333333333';
const E = '77777777-7777-4777-8777-777777777777';
const S = '44444444-4444-4444-8444-444444444444';
const N = '55555555-5555-4555-8555-555555555555';
const C2 = '66666666-6666-4666-8666-666666666666';

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
  'supabase/migrations/20261116150000_shared_dashboards.sql'
].forEach(function (file) { psql('wb_shares_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${C}', 'ada@example.com'),
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${N}', 'neil@example.com'),
  ('${C2}', 'bea@example.com');
update public.profiles set membership = 'free_client', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'master_trainer', email = 'master@example.com' where id = '${M}';
update public.profiles set membership = 'enthusiast', email = 'fan@example.com' where id = '${E}';
update public.profiles set membership = 'trainer', email = 'stranger@example.com' where id = '${S}';
update public.profiles set membership = 'free_client', email = 'neil@example.com' where id = '${N}';
update public.profiles set membership = 'free_client', email = 'bea@example.com' where id = '${C2}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${M}', '${C2}'),
  ('${E}', '${N}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
select public.tracking_save_session(
  jsonb_build_object(
    'localId', 'ses_ada',
    'workoutName', 'Lower',
    'origin', 'own',
    'startedAt', '2026-11-16T15:00:00Z',
    'endedAt', '2026-11-16T15:20:00Z',
    'timeZone', 'UTC',
    'localDate', '2026-11-16',
    'status', 'completed'
  ),
  jsonb_build_array(jsonb_build_object(
    'step', 0, 'setNumber', 1, 'status', 'completed',
    'stableKey', 'ex_squat', 'exerciseName', 'Squat', 'mode', 'reps', 'displayUnit', 'kg',
    'plannedReps', 5, 'actualReps', 5, 'plannedWeight', 20, 'actualWeight', 20
  ))
);

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions where client_id = '${C}';
  if n <> 1 then raise exception 'trainer cannot read the connected session %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${C}';
  if n <> 1 then raise exception 'trainer cannot read the connected sets %', n; end if;
end $$;

insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
values (
  '${C}', '${T}', 'Coach Lee', '2026-11-16',
  '[{"type":"plan","plan":{"pct":65,"hits":11,"total":17}}]'::jsonb
);

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
values (
  '${C2}', '${M}', 'Master Lee', '2026-11-16',
  '[{"type":"pass","pass":{"pct":63,"passes":5,"total":8}}]'::jsonb
);

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${C2}', '${T}', 'Coach Lee', '2026-11-16', '[{"type":"plan"}]'::jsonb);
    raise exception 'trainer shared with someone else''s client';
  exception when others then
    if sqlerrm not like '%connected client%' and sqlerrm not like '%row-level security%' then raise; end if;
  end;
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values (
      '${C}', '${T}', 'Coach Lee', '2026-11-16',
      '[{"type":"plan"},{"type":"plan"}]'::jsonb
    );
    raise exception 'duplicate card was stored';
  exception when others then
    if sqlerrm not like '%once%' and sqlerrm not like '%row-level security%' then raise; end if;
  end;
  begin
    update public.shared_dashboards set trainer_name = 'Changed' where client_id = '${C}';
    if found then raise exception 'trainer edited a shared dashboard'; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
begin
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${N}', '${E}', 'Fan', '2026-11-16', '[{"type":"plan"}]'::jsonb);
    raise exception 'enthusiast shared a dashboard';
  exception when others then
    if sqlerrm not like '%Only a trainer%' and sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_sessions;
  if n <> 0 then raise exception 'stranger sees sessions %', n; end if;
  select count(*) into n from public.shared_dashboards;
  if n <> 0 then raise exception 'stranger sees shares %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int; sid uuid;
begin
  select count(*) into n from public.shared_dashboards;
  if n <> 1 then raise exception 'client share count %', n; end if;
  if (select trainer_name from public.shared_dashboards) is distinct from 'Coach Lee' then
    raise exception 'stamp name changed';
  end if;
  select id into sid from public.shared_dashboards;
  update public.shared_dashboards set viewed_at = now() where id = sid;
  if (select viewed_at from public.shared_dashboards where id = sid) is null then
    raise exception 'opening did not mark viewed';
  end if;
  begin
    update public.shared_dashboards set viewed_at = now() where id = sid;
    raise exception 'a second open rewrote viewed_at';
  exception when others then
    if sqlerrm not like '%already opened%' then raise; end if;
  end;
  begin
    update public.shared_dashboards set cards = '[{"type":"pass"}]'::jsonb where id = sid;
    raise exception 'client edited the cards';
  exception when others then
    if sqlerrm not like '%cannot be changed%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${N}', false);
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards;
  if n <> 0 then raise exception 'other client sees a share %', n; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from auth.users where id = '${C}';
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards where client_id = '${C}' or trainer_id = '${C}';
  if n <> 0 then raise exception 'account delete left client shares %', n; end if;
  select count(*) into n from public.workout_sets where client_id = '${C}';
  if n <> 0 then raise exception 'account delete left sets %', n; end if;
  select count(*) into n from public.workout_sessions where client_id = '${C}';
  if n <> 0 then raise exception 'account delete left sessions %', n; end if;
  select count(*) into n from public.personal_exercises where user_id = '${C}';
  if n <> 0 then raise exception 'account delete left exercises %', n; end if;
  select count(*) into n from public.profiles where id = '${T}';
  if n <> 1 then raise exception 'trainer account was removed'; end if;
end $$;
delete from auth.users where id = '${M}';
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards where trainer_id = '${M}';
  if n <> 0 then raise exception 'account delete left trainer shares %', n; end if;
  select count(*) into n from public.profiles where id = '${C2}';
  if n <> 1 then raise exception 'the client was removed with the trainer'; end if;
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
