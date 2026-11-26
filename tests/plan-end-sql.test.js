// Plan end and the 14-day data hold. Local Postgres only. Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migrationName = '20261126145138_plan_end_data_hold.sql';
const migration = path.join(root, 'supabase/migrations', migrationName);
const sqlText = fs.readFileSync(migration, 'utf8');

[
  'plan_ended_at',
  'private.purge_ended_plan_data',
  'private.purge_ended_account',
  'purge-ended-plan-data',
  '15 4 * * *',
  "interval '14 days'",
  'security definer',
  "set search_path = ''",
  'revoke all on function private.purge_ended_plan_data()',
  'from public',
  'newly_ended',
  'free_client',
  'workout_sessions',
  'workout_sets',
  'personal_exercises',
  'shared_dashboards',
  'trainer_clients'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(!/\b(sk|rk)_(live|test)_/i.test(sqlText));
assert.ok(!/\bwhsec_/i.test(sqlText));
assert.ok(sqlText.indexOf("p_action: 'past_due'") === -1);

const PAYER = '11111111-1111-4111-8111-111111111111';
const EARLY = '22222222-2222-4222-8222-222222222222';
const LINKED = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const FREE = '55555555-5555-4555-8555-555555555555';
const RECENT = '66666666-6666-4666-8666-666666666666';
const ACTIVE = '77777777-7777-4777-8777-777777777777';
const FREEOLD = '88888888-8888-4888-8888-888888888888';
const DB = 'wb_plan_end_test';

function psql(db, sql, filePath) {
  const args = ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', db];
  const opts = { encoding: 'utf8' };
  if (filePath) args.push('-f', filePath);
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

const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'))
  .filter(function (name) { return name.endsWith('.sql'); })
  .sort();

psql('postgres', 'drop database if exists ' + DB + ';\ncreate database ' + DB + ';\n');
psql(DB, `
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`);
migrations.forEach(function (name) {
  psql(DB, null, path.join(root, 'supabase/migrations', name));
});

psql(DB, `
insert into auth.users (id, email) values
  ('${PAYER}', 'payer@example.com'),
  ('${EARLY}', 'early@example.com'),
  ('${LINKED}', 'linked@example.com'),
  ('${OLD}', 'old@example.com'),
  ('${FREE}', 'free@example.com'),
  ('${RECENT}', 'recent@example.com'),
  ('${ACTIVE}', 'active@example.com'),
  ('${FREEOLD}', 'freeold@example.com');
update public.profiles set access_approved = true, membership = 'none', display_name = 'Payer', intended_plan = 'trainer' where id = '${PAYER}';
update public.profiles set access_approved = true, membership = 'trainer', display_name = 'Early' where id = '${EARLY}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Linked' where id = '${LINKED}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Old' where id = '${OLD}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Free' where id = '${FREE}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Recent' where id = '${RECENT}';
update public.profiles set access_approved = true, membership = 'trainer', display_name = 'Active' where id = '${ACTIVE}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Free Old' where id = '${FREEOLD}';
`);

psql(DB, `
reset role;
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claim.sub', '', false);
do $$
declare
  result jsonb;
  stamp timestamptz;
  again timestamptz;
  intended text;
  n int;
begin
  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'grant', 'trainer', null, 'cus_payerhold1', 'sub_payerhold1',
    now() + interval '20 days', null
  );
  if result ->> 'membership' is distinct from 'trainer'
     or result ->> 'plan_ended_at' is not null
     or (result ->> 'newly_ended')::boolean then
    raise exception 'grant did not clear the hold: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'end', null, 'canceled', 'cus_payerhold1', 'sub_payerhold1',
    now() - interval '1 minute', null
  );
  if result ->> 'membership' is distinct from 'none'
     or result ->> 'billing_status' is distinct from 'canceled'
     or (result ->> 'newly_ended')::boolean is not true
     or result ->> 'plan_ended_at' is null then
    raise exception 'end did not clear the plan: %', result;
  end if;
  select plan_ended_at, intended_plan into stamp, intended from public.profiles where id = '${PAYER}';
  if stamp is null then raise exception 'plan_ended_at was not stored'; end if;
  if intended is not null then raise exception 'intended plan stayed set'; end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'end', null, 'canceled', 'cus_payerhold1', 'sub_payerhold1',
    now() - interval '1 minute', null
  );
  select plan_ended_at into again from public.profiles where id = '${PAYER}';
  if again is distinct from stamp or (result ->> 'newly_ended')::boolean then
    raise exception 'a second end moved the hold: % / %', again, result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'grant', 'enthusiast', null, 'cus_payerhold1', 'sub_payerhold2',
    now() + interval '20 days', null
  );
  if result ->> 'membership' is distinct from 'enthusiast'
     or result ->> 'plan_ended_at' is not null then
    raise exception 'resubscribe did not clear plan_ended_at: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'past_due', null, null, 'cus_payerhold1', 'sub_payerhold2', null, null
  );
  if result ->> 'membership' is distinct from 'none'
     or result ->> 'billing_status' is distinct from 'canceled'
     or result ->> 'plan_ended_at' is null then
    raise exception 'past_due still has access: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'grant', 'trainer', null, 'cus_payerhold1', 'sub_payerhold3',
    now() + interval '20 days', null
  );
  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'sync', 'trainer', 'past_due', 'cus_payerhold1', 'sub_payerhold3',
    now() + interval '20 days', null
  );
  if result ->> 'membership' is distinct from 'none'
     or result ->> 'billing_status' is distinct from 'canceled' then
    raise exception 'sync past_due kept the plan: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'grant', 'trainer', null, 'cus_payerhold1', 'sub_payerhold4',
    now() + interval '20 days', null
  );
  result := public.apply_stripe_membership(
    '${PAYER}'::uuid, 'sync', null, 'canceled', 'cus_payerhold1', 'sub_payerhold4',
    timestamptz '2099-01-01 00:00:00+00', null
  );
  if result ->> 'membership' is distinct from 'trainer' then
    raise exception 'cancel at period end removed access: %', result;
  end if;

  update public.profiles
    set complimentary = true, membership = 'trainer', billing_status = null,
        stripe_customer_id = null, stripe_subscription_id = null, plan_ended_at = null
  where id = '${EARLY}';
  result := public.apply_stripe_membership(
    '${EARLY}'::uuid, 'end', null, null, null, null, now() - interval '1 day', null
  );
  if result ->> 'membership' is distinct from 'trainer'
     or (result ->> 'complimentary')::boolean is not true then
    raise exception 'complimentary coach was ended: %', result;
  end if;

  update public.profiles
    set complimentary = false, membership = 'trainer', billing_status = null,
        stripe_customer_id = null, stripe_subscription_id = null
  where id = '${EARLY}';
  result := public.apply_stripe_membership(
    '${LINKED}'::uuid, 'grant', 'enthusiast', null, 'cus_linkedhold1', 'sub_linkedhold1',
    now() + interval '10 days', null
  );
  insert into public.trainer_clients (trainer_id, client_id) values ('${EARLY}', '${LINKED}');
  result := public.apply_stripe_membership(
    '${LINKED}'::uuid, 'end', null, 'canceled', 'cus_linkedhold1', 'sub_linkedhold1',
    now() - interval '1 minute', null
  );
  if result ->> 'membership' is distinct from 'none' then
    raise exception 'linked payer should have no plan: %', result;
  end if;
  select count(*) into n from public.trainer_clients
    where trainer_id = '${EARLY}' and client_id = '${LINKED}' and ended_at is null;
  if n <> 1 then raise exception 'plan end unlinked the client early'; end if;

  update public.profiles
    set membership = 'none', billing_status = 'canceled', plan_ended_at = now() - interval '15 days',
        stripe_customer_id = 'cus_oldhold001', stripe_subscription_id = 'sub_oldhold001', intended_plan = null
  where id = '${OLD}';
  update public.profiles
    set membership = 'none', billing_status = 'canceled', plan_ended_at = now() - interval '10 days',
        intended_plan = null
  where id = '${RECENT}';
  update public.profiles
    set membership = 'free_client', plan_ended_at = now() - interval '30 days', billing_status = null
  where id = '${FREEOLD}';

  insert into public.account_workouts (owner_id, local_id, name)
  values
    ('${OLD}', 'w_old', 'Old workout'),
    ('${RECENT}', 'w_recent', 'Recent workout'),
    ('${ACTIVE}', 'w_active', 'Active workout'),
    ('${FREE}', 'w_free', 'Free workout'),
    ('${FREEOLD}', 'w_freeold', 'Free old workout');
  insert into public.trainer_clients (trainer_id, client_id) values ('${OLD}', '${FREE}');
  insert into public.messages (id, trainer_id, client_id, sender_id, body)
  values ('99999999-9999-4999-8999-999999999999', '${OLD}', '${FREE}', '${OLD}', 'See you Thursday');
  insert into public.personal_exercises (user_id, stable_key, name)
  values ('${OLD}', 'ex_old', 'Old squat'), ('${FREE}', 'ex_free', 'Free squat');
  insert into public.workout_sessions (
    client_id, local_id, origin, started_at, ended_at, time_zone, local_date, status
  ) values
    ('${OLD}', 'ses_old', 'own', now() - interval '1 hour', now(), 'UTC', current_date, 'completed'),
    ('${FREE}', 'ses_free', 'own', now() - interval '1 hour', now(), 'UTC', current_date, 'completed');
  insert into public.workout_sets (
    session_id, client_id, step, personal_exercise_id, exercise_name, mode, set_number,
    status, logged_by_role, display_unit
  )
  select s.id, s.client_id, 1, e.id, e.name, 'reps', 1, 'completed', 'client', 'kg'
  from public.workout_sessions s
  join public.personal_exercises e on e.user_id = s.client_id
  where s.client_id in ('${OLD}', '${FREE}');
end $$;
`);

psql(DB, `
set role authenticated;
select set_config('request.jwt.claim.sub', '${PAYER}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
do $$
begin
  begin
    update public.profiles set plan_ended_at = null where id = '${PAYER}';
    raise exception 'signed-in person cleared plan_ended_at';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform private.purge_ended_plan_data();
    raise exception 'signed-in person ran the cleanup';
  exception when insufficient_privilege then
    null;
  end;
end $$;
`);

psql(DB, `
reset role;
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claim.sub', '', false);
do $$
declare n int;
begin
  if private.purge_ended_plan_data() <> 1 then
    raise exception 'cleanup count was not the one old account';
  end if;
  select count(*) into n from public.profiles where id = '${OLD}';
  if n <> 1 then raise exception 'old account was deleted'; end if;
  if (select membership from public.profiles where id = '${OLD}') is distinct from 'none' then
    raise exception 'old account is not a no-plan user';
  end if;
  if (select plan_ended_at from public.profiles where id = '${OLD}') is not null then
    raise exception 'cleaned account still has plan_ended_at';
  end if;
  select count(*) into n from public.account_workouts where owner_id = '${OLD}';
  if n <> 0 then raise exception 'old workout remained'; end if;
  select count(*) into n from public.personal_exercises where user_id = '${OLD}';
  if n <> 0 then raise exception 'old exercise remained'; end if;
  select count(*) into n from public.workout_sessions where client_id = '${OLD}';
  if n <> 0 then raise exception 'old session remained'; end if;
  select count(*) into n from public.workout_sets where client_id = '${OLD}';
  if n <> 0 then raise exception 'old set remained'; end if;
  select count(*) into n from public.messages where trainer_id = '${OLD}' or client_id = '${OLD}';
  if n <> 0 then raise exception 'old messages remained'; end if;
  select count(*) into n from public.trainer_clients
    where trainer_id = '${OLD}' and client_id = '${FREE}' and ended_at is null;
  if n <> 0 then raise exception 'trainer link stayed active'; end if;
  select count(*) into n from public.trainer_clients
    where trainer_id = '${OLD}' and client_id = '${FREE}' and ended_at is not null;
  if n <> 1 then raise exception 'trainer link was deleted instead of ended'; end if;

  select count(*) into n from public.profiles where id = '${FREE}';
  if n <> 1 then raise exception 'free client account was deleted'; end if;
  if (select membership from public.profiles where id = '${FREE}') is distinct from 'free_client' then
    raise exception 'free client membership changed';
  end if;
  select count(*) into n from public.account_workouts where owner_id = '${FREE}';
  if n <> 1 then raise exception 'free client workout was deleted'; end if;
  select count(*) into n from public.personal_exercises where user_id = '${FREE}';
  if n <> 1 then raise exception 'free client exercise was deleted'; end if;
  select count(*) into n from public.workout_sessions where client_id = '${FREE}';
  if n <> 1 then raise exception 'free client session was deleted'; end if;

  select count(*) into n from public.account_workouts where owner_id = '${RECENT}';
  if n <> 1 then raise exception '10-day workout was deleted'; end if;
  if (select plan_ended_at from public.profiles where id = '${RECENT}') is null then
    raise exception '10-day hold was cleared';
  end if;
  select count(*) into n from public.account_workouts where owner_id = '${ACTIVE}';
  if n <> 1 then raise exception 'active workout was deleted'; end if;
  select count(*) into n from public.account_workouts where owner_id = '${FREEOLD}';
  if n <> 1 then raise exception 'free client with an old timestamp was cleaned'; end if;
  if (select membership from public.profiles where id = '${FREEOLD}') is distinct from 'free_client' then
    raise exception 'marked free client was changed';
  end if;

  perform private.purge_ended_account('${FREE}'::uuid);
  select count(*) into n from public.account_workouts where owner_id = '${FREE}';
  if n <> 1 then raise exception 'direct cleanup deleted a free client'; end if;

  if private.purge_ended_plan_data() <> 0 then
    raise exception 'second cleanup deleted more accounts';
  end if;
end $$;
`);

console.log('PLAN END SQL OK');
