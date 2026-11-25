// Stripe billing schema. Local Postgres only. Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migrationName = '20261125200000_stripe_billing.sql';
const migration = path.join(root, 'supabase/migrations', migrationName);
const sqlText = fs.readFileSync(migration, 'utf8');

[
  'stripe_customer_id',
  'stripe_subscription_id',
  'billing_status',
  'current_period_end',
  'beta_locked',
  'complimentary',
  'public.stripe_events',
  'public.beta_cohort_state',
  'public.beta_reservations',
  'apply_stripe_membership',
  'beta_reservation_hold',
  'beta_reservation_confirm',
  'beta_reservation_release',
  'stripe_event_begin',
  'security definer',
  "set search_path = ''",
  'for update',
  'revoke all on function public.apply_stripe_membership',
  'from public, anon, authenticated',
  'to service_role',
  'using (false)',
  'Billing changes require payment.',
  'Checkout opens after an admin approves the account.',
  'interval \'30 minutes\'',
  'cohort_limit = 100',
  'free_client',
  '$9.99',
  '$19.99',
  '$29.99'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(!/\b(sk|rk)_(live|test)_/i.test(sqlText));
assert.ok(!/\bwhsec_/i.test(sqlText));
assert.ok(!/\bpk_(live|test)_/i.test(sqlText));
assert.ok(!/\bbegin\s*;/i.test(sqlText));
assert.ok(!/\bcommit\s*;/i.test(sqlText));

const EARLY = '11111111-1111-4111-8111-111111111111';
const FAN = '22222222-2222-4222-8222-222222222222';
const FREE = '33333333-3333-4333-8333-333333333333';
const PAYER = '44444444-4444-4444-8444-444444444444';
const WAIT = '55555555-5555-4555-8555-555555555555';
const LINKED = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const LATE = '88888888-8888-4888-8888-888888888888';
const RACE1 = '99999999-9999-4999-8999-999999999999';
const RACE2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DB = 'wb_stripe_billing_test';

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
  .filter(function (name) { return name.endsWith('.sql') && name < migrationName; })
  .sort();

psql('postgres', 'drop database if exists ' + DB + ';\ncreate database ' + DB + ';\n');
psql(DB, `
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
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
  ('${EARLY}', 'early@example.com'),
  ('${FAN}', 'fan@example.com'),
  ('${FREE}', 'free@example.com'),
  ('${PAYER}', 'payer@example.com'),
  ('${WAIT}', 'wait@example.com'),
  ('${LINKED}', 'linked@example.com'),
  ('${OTHER}', 'other@example.com'),
  ('${RACE1}', 'race1@example.com'),
  ('${RACE2}', 'race2@example.com');
update public.profiles set access_approved = true, membership = 'trainer', display_name = 'Early Coach' where id = '${EARLY}';
update public.profiles set access_approved = true, membership = 'enthusiast', display_name = 'Early Fan' where id = '${FAN}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Free Client' where id = '${FREE}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Payer' where id = '${PAYER}';
update public.profiles set access_approved = false, membership = 'none', display_name = 'Waiting' where id = '${WAIT}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Linked' where id = '${LINKED}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Other' where id = '${OTHER}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Race One' where id = '${RACE1}';
update public.profiles set access_approved = true, membership = 'none', display_name = 'Race Two' where id = '${RACE2}';
`);
psql(DB, null, migration);

psql(DB, `
do $$
declare
  n int;
  flag boolean;
  def text;
  args text;
begin
  select complimentary into flag from public.profiles where id = '${EARLY}';
  if flag is not true then raise exception 'early trainer was not marked complimentary'; end if;
  select complimentary into flag from public.profiles where id = '${FAN}';
  if flag is not true then raise exception 'early enthusiast was not marked complimentary'; end if;
  select complimentary into flag from public.profiles where id = '${FREE}';
  if flag then raise exception 'free client was marked complimentary'; end if;
  select complimentary into flag from public.profiles where id = '${PAYER}';
  if flag then raise exception 'new account was marked complimentary'; end if;
  select beta_locked into flag from public.profiles where id = '${EARLY}';
  if flag then raise exception 'early tester was counted as Beta'; end if;
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 0 then raise exception 'Beta count started at %', n; end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update') then
    raise exception 'profile save lost display_name';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'intended_plan', 'update') then
    raise exception 'profile save lost intended_plan';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'stripe_customer_id', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'stripe_subscription_id', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'billing_status', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'current_period_end', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'beta_locked', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'complimentary', 'update') then
    raise exception 'authenticated can update a billing column';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'stripe_customer_id', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'stripe_customer_id', 'insert') then
    raise exception 'a client can insert a stripe customer id';
  end if;

  if has_table_privilege('anon', 'public.stripe_events', 'select')
     or has_table_privilege('authenticated', 'public.stripe_events', 'select')
     or has_table_privilege('anon', 'public.stripe_events', 'insert')
     or has_table_privilege('authenticated', 'public.beta_reservations', 'select')
     or has_table_privilege('anon', 'public.beta_cohort_state', 'select')
     or has_table_privilege('authenticated', 'private.billing_grandfather', 'select') then
    raise exception 'a client can read billing tables';
  end if;

  select c.relrowsecurity into flag
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname = 'stripe_events';
  if flag is not true then raise exception 'stripe_events has no row security'; end if;
  select c.relrowsecurity into flag
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname = 'beta_reservations';
  if flag is not true then raise exception 'beta_reservations has no row security'; end if;
  select count(*) into n
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname in ('stripe_events', 'beta_reservations', 'beta_cohort_state')
    and (
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') is distinct from 'false'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') is distinct from 'false'
    );
  if n <> 0 then raise exception 'a billing policy allows a client'; end if;

  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'apply_stripe_membership',
      'beta_reservation_hold',
      'beta_reservation_attach',
      'beta_reservation_confirm',
      'beta_reservation_release',
      'beta_reservation_release_expired',
      'stripe_event_begin'
    )
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('public', p.oid, 'execute')
      or not has_function_privilege('service_role', p.oid, 'execute')
    );
  if n <> 0 then raise exception 'a billing function is not service-role only'; end if;

  select pg_get_functiondef(p.oid), coalesce(array_to_string(p.proconfig, ','), '')
    into def, args
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'apply_stripe_membership';
  if position('security definer' in lower(def)) = 0 then
    raise exception 'apply_stripe_membership is not security definer';
  end if;
  if args not like '%search_path=%' then
    raise exception 'apply_stripe_membership search_path %', args;
  end if;
  select pg_get_functiondef('public.beta_reservation_hold(uuid, text)'::regprocedure) into def;
  if position('for update' in lower(def)) = 0 then
    raise exception 'beta hold does not lock the counter';
  end if;
end $$;
`);

psql(DB, `
set role authenticated;
select set_config('request.jwt.claim.sub', '${PAYER}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
do $$
declare
  name text;
  stamp timestamptz;
  seen timestamptz;
begin
  select updated_at into stamp from public.profiles where id = '${PAYER}';
  update public.profiles
    set display_name = 'Payer Saved', intended_plan = 'enthusiast'
    where id = '${PAYER}';
  select display_name, updated_at into name, seen from public.profiles where id = '${PAYER}';
  if name is distinct from 'Payer Saved' then raise exception 'name was not saved'; end if;
  if seen <= stamp then raise exception 'profile save did not stamp updated_at'; end if;
  begin
    update public.profiles set stripe_customer_id = 'cus_hacked' where id = '${PAYER}';
    raise exception 'payer wrote a stripe customer id';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles
      set display_name = 'Still Payer', billing_status = 'active'
      where id = '${PAYER}';
    raise exception 'payer wrote billing status beside a name';
  exception when insufficient_privilege then
    null;
  end;
  select display_name into name from public.profiles where id = '${PAYER}';
  if name is distinct from 'Payer Saved' then raise exception 'failed billing write changed the name to %', name; end if;
  begin
    perform public.beta_reservation_hold('${PAYER}'::uuid, 'enthusiast');
    raise exception 'signed-in person held a Beta slot';
  exception when insufficient_privilege then
    null;
  end;
end $$;
`);

psql(DB, `
grant update (stripe_customer_id) on public.profiles to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '${PAYER}', false);
do $$
declare kept text;
begin
  begin
    update public.profiles set stripe_customer_id = 'cus_hacked' where id = '${PAYER}';
    raise exception 'trigger allowed a billing write';
  exception when others then
    if sqlerrm not like '%Billing changes require payment%' then
      raise exception 'billing trigger said %', sqlerrm;
    end if;
  end;
  select stripe_customer_id into kept from public.profiles where id = '${PAYER}';
  if kept is not null then raise exception 'stripe customer id was stored'; end if;
end $$;
`);
psql(DB, `revoke update (stripe_customer_id) on public.profiles from authenticated;`);
psql(DB, `
grant execute on function public.beta_reservation_hold(uuid, text) to authenticated;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '${PAYER}', false);
do $$
begin
  begin
    perform public.beta_reservation_hold('${PAYER}'::uuid, 'trainer');
    raise exception 'signed-in JWT ran a Beta hold';
  exception when others then
    if sqlerrm not like '%Billing changes are not available here%' then
      raise exception 'service check said %', sqlerrm;
    end if;
  end;
end $$;
`);
psql(DB, `revoke execute on function public.beta_reservation_hold(uuid, text) from authenticated;`);

psql(DB, `
grant select on public.stripe_events to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '${PAYER}', false);
do $$
declare n int;
begin
  select count(*) into n from public.stripe_events;
  if n <> 0 then raise exception 'client read stripe events %', n; end if;
end $$;
`);
psql(DB, `revoke select on public.stripe_events from authenticated;`);

psql(DB, `
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
select public.stripe_event_begin('evt_rolecheck', 'customer.subscription.updated');
`);
psql(DB, `
do $$
declare
  hold jsonb;
  again jsonb;
  result jsonb;
  n int;
  flag boolean;
  exp timestamptz;
  exp2 timestamptz;
  sid text;
  first_id uuid;
  counted boolean;
begin
  begin
    perform public.beta_reservation_hold('${WAIT}'::uuid, 'enthusiast');
    raise exception 'unapproved checkout took a slot';
  exception when others then
    if sqlerrm not like '%approves the account%' then
      raise exception 'approval check said %', sqlerrm;
    end if;
  end;

  hold := public.beta_reservation_hold('${PAYER}'::uuid, 'enthusiast');
  if hold ->> 'cohort' is distinct from 'beta' then raise exception 'first payer was %', hold; end if;
  if hold ->> 'reservation_id' is null then raise exception 'beta hold had no reservation'; end if;
  first_id := (hold ->> 'reservation_id')::uuid;
  select expires_at into exp from public.beta_reservations where id = first_id;
  if exp <= now() + interval '29 minutes' or exp > now() + interval '31 minutes' then
    raise exception 'hold did not last about 30 minutes: %', exp - now();
  end if;

  again := public.beta_reservation_hold('${PAYER}'::uuid, 'trainer');
  if (again ->> 'reservation_id')::uuid is distinct from first_id then
    raise exception 'retry created a second hold';
  end if;
  select expires_at, plan into exp2, sid from public.beta_reservations where id = first_id;
  if exp2 is distinct from exp then raise exception 'retry extended the hold'; end if;
  if sid is distinct from 'trainer' then raise exception 'retry did not keep the new plan'; end if;

  perform public.beta_reservation_attach(first_id, 'cs_test_payer1');
  perform public.beta_reservation_attach(first_id, 'cs_test_payer1');
  begin
    perform public.beta_reservation_attach(first_id, 'cs_test_other');
    raise exception 'reservation accepted a second checkout';
  exception when others then
    if sqlerrm not like '%already has a checkout%' then
      raise exception 'attach said %', sqlerrm;
    end if;
  end;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid,
    'grant',
    'enthusiast',
    null,
    'cus_payer001',
    'sub_payer001',
    timestamptz '2026-12-25 00:00:00+00',
    'cs_test_payer1'
  );
  if result ->> 'membership' is distinct from 'enthusiast'
     or result ->> 'billing_status' is distinct from 'active'
     or (result ->> 'beta_locked')::boolean is not true then
    raise exception 'grant did not lock Beta: %', result;
  end if;
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 1 then raise exception 'confirm counted %', n; end if;
  select status into sid from public.beta_reservations where id = first_id;
  if sid is distinct from 'confirmed' then raise exception 'reservation stayed %', sid; end if;

  result := public.beta_reservation_confirm('${PAYER}'::uuid, 'cs_test_payer1');
  if (result ->> 'counted')::boolean then raise exception 'confirm counted twice'; end if;
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 1 then raise exception 'second confirm counted %', n; end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid,
    'grant',
    'trainer',
    null,
    'cus_payer001',
    'sub_payer001',
    timestamptz '2026-12-25 00:00:00+00',
    null
  );
  if result ->> 'membership' is distinct from 'trainer'
     or (result ->> 'beta_locked')::boolean is not true then
    raise exception 'plan switch left Beta: %', result;
  end if;
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 1 then raise exception 'plan switch counted %', n; end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid,
    'past_due',
    'enthusiast',
    null,
    null,
    'sub_payer001',
    null,
    null
  );
  if result ->> 'membership' is distinct from 'trainer'
     or result ->> 'billing_status' is distinct from 'past_due' then
    raise exception 'past_due changed access: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid,
    'sync',
    null,
    'canceled',
    null,
    'sub_payer001',
    timestamptz '2099-01-01 00:00:00+00',
    null
  );
  if result ->> 'membership' is distinct from 'trainer'
     or result ->> 'billing_status' is distinct from 'canceled' then
    raise exception 'cancel before period end removed access: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${PAYER}'::uuid,
    'end',
    null,
    null,
    null,
    'sub_payer001',
    timestamptz '2020-01-01 00:00:00+00',
    null
  );
  if result ->> 'membership' is distinct from 'none'
     or result ->> 'billing_status' is distinct from 'canceled'
     or (result ->> 'beta_locked')::boolean is not true then
    raise exception 'ended payer should have no plan and keep the lock: %', result;
  end if;

  select beta_locked into flag from public.profiles where id = '${EARLY}';
  if flag then raise exception 'coach was beta locked'; end if;
  result := public.apply_stripe_membership(
    '${EARLY}'::uuid,
    'end',
    null,
    null,
    null,
    null,
    timestamptz '2020-01-01 00:00:00+00',
    null
  );
  if result ->> 'membership' is distinct from 'trainer'
     or (result ->> 'complimentary')::boolean is not true then
    raise exception 'complimentary coach was downgraded: %', result;
  end if;

  insert into public.trainer_clients (trainer_id, client_id)
  values ('${EARLY}', '${LINKED}');
  result := public.apply_stripe_membership(
    '${LINKED}'::uuid,
    'grant',
    'enthusiast',
    null,
    'cus_linked001',
    'sub_linked001',
    timestamptz '2026-12-01 00:00:00+00',
    null
  );
  if result ->> 'membership' is distinct from 'enthusiast' then
    raise exception 'linked grant failed: %', result;
  end if;
  if (result ->> 'beta_locked')::boolean then
    raise exception 'grant without a hold locked Beta';
  end if;
  result := public.apply_stripe_membership(
    '${LINKED}'::uuid,
    'end',
    null,
    null,
    null,
    'sub_linked001',
    timestamptz '2020-01-01 00:00:00+00',
    null
  );
  if result ->> 'membership' is distinct from 'free_client' then
    raise exception 'linked cancel should be Free Client: %', result;
  end if;

  result := public.apply_stripe_membership(
    '${LINKED}'::uuid,
    'end',
    null,
    null,
    null,
    'sub_other',
    timestamptz '2020-01-01 00:00:00+00',
    null
  );
  if (result ->> 'applied')::boolean is not false
     or result ->> 'membership' is distinct from 'free_client' then
    raise exception 'stale subscription changed the row: %', result;
  end if;

  if public.stripe_event_begin('evt_paid001', 'invoice.paid') is not true then
    raise exception 'first event was not new';
  end if;
  if public.stripe_event_begin('evt_paid001', 'invoice.paid') is not false then
    raise exception 'duplicate event was processed';
  end if;
  select count(*) into n from public.stripe_events where id = 'evt_paid001';
  if n <> 1 then raise exception 'event row count %', n; end if;

  begin
    perform public.apply_stripe_membership(
      '${OTHER}'::uuid,
      'attach',
      null,
      'incomplete',
      'cus_payer001',
      'sub_other001',
      null,
      null
    );
    raise exception 'customer id was reused';
  exception when others then
    if sqlerrm not like '%already linked to another account%' then
      raise exception 'duplicate customer said %', sqlerrm;
    end if;
  end;

  update public.beta_cohort_state set confirmed_count = 100;
  hold := public.beta_reservation_hold('${OTHER}'::uuid, 'master_trainer');
  if hold ->> 'cohort' is distinct from 'standard' or hold ->> 'reservation_id' is not null then
    raise exception 'person 101 got Beta: %', hold;
  end if;
  select count(*) into n from public.beta_reservations
    where profile_id = '${OTHER}' and status = 'held';
  if n <> 0 then raise exception 'standard checkout stored a hold'; end if;

  hold := public.beta_reservation_hold('${PAYER}'::uuid, 'enthusiast');
  if hold ->> 'cohort' is distinct from 'beta' or hold ->> 'reservation_id' is not null
     or (hold ->> 'beta_locked')::boolean is not true then
    raise exception 'locked payer was not kept on Beta: %', hold;
  end if;

  update public.beta_cohort_state set confirmed_count = 99;
  hold := public.beta_reservation_hold('${OTHER}'::uuid, 'enthusiast');
  if hold ->> 'cohort' is distinct from 'beta' then raise exception 'slot 100 was %', hold; end if;
  update public.beta_reservations
    set expires_at = now() - interval '1 minute'
    where id = (hold ->> 'reservation_id')::uuid;
  if public.beta_reservation_release_expired() <> 1 then
    raise exception 'expired hold was not released';
  end if;
  hold := public.beta_reservation_hold('${FREE}'::uuid, 'trainer');
  if hold ->> 'cohort' is distinct from 'beta' then
    raise exception 'released slot was not reused: %', hold;
  end if;
  perform public.beta_reservation_release('${FREE}'::uuid, null, null);
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 99 then raise exception 'release changed the confirmed count to %', n; end if;

  hold := public.beta_reservation_hold('${OTHER}'::uuid, 'trainer');
  if hold ->> 'cohort' is distinct from 'beta' then raise exception 'expected a live hold'; end if;
  again := public.beta_reservation_hold('${FREE}'::uuid, 'enthusiast');
  if again ->> 'cohort' is distinct from 'standard' then
    raise exception 'active hold did not fill the cohort: %', again;
  end if;
  perform public.beta_reservation_release(null, null, (hold ->> 'reservation_id')::uuid);

  select (public.beta_reservation_confirm('${OTHER}'::uuid, null) ->> 'counted')::boolean into counted;
  if counted then raise exception 'confirm with no hold incremented the count'; end if;
end $$;
`);

psql(DB, `
reset role;
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claim.sub', '', false);
update public.beta_cohort_state set confirmed_count = 4;
`);
psql(DB, `
insert into auth.users (id, email) values ('${LATE}', 'late@example.com');
update public.profiles
  set access_approved = true, membership = 'trainer', display_name = 'Late Coach'
  where id = '${LATE}';
`);
psql(DB, null, migration);
psql(DB, `
do $$
declare n int; flag boolean;
begin
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 4 then raise exception 'second run reset the Beta count to %', n; end if;
  select complimentary into flag from public.profiles where id = '${LATE}';
  if flag then raise exception 'second run marked a later trainer complimentary'; end if;
  select complimentary into flag from public.profiles where id = '${EARLY}';
  if flag is not true then raise exception 'second run cleared complimentary'; end if;
  select count(*) into n from public.stripe_events where id = 'evt_paid001';
  if n <> 1 then raise exception 'second run duplicated an event'; end if;
end $$;
`);

psql(DB, `
select set_config('request.jwt.claim.sub', '', false);
update public.beta_cohort_state set confirmed_count = 99;
update public.beta_reservations
  set status = 'released', released_at = now()
  where status = 'held';
`);

function psqlAsync(sql) {
  return new Promise(function (resolve) {
    const child = spawn('sudo', [
      '-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', DB, '-f', '-'
    ]);
    let out = '';
    let err = '';
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { err += d; });
    child.on('close', function (code) { resolve({ code: code, out: out, err: err }); });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

const raceSql = function (id, plan) {
  return `
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
begin;
select public.beta_reservation_hold('${id}'::uuid, '${plan}') ->> 'cohort';
select pg_sleep(2);
commit;
`;
};

const first = psqlAsync(raceSql(RACE1, 'enthusiast'));
  const started = Date.now();
let sleeping = false;
while (Date.now() - started < 8000) {
  const probe = spawnSync('sudo', [
    '-u', 'postgres', 'psql', '-q', '-t', '-A', '-d', DB, '-c',
    "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state = 'active' and query ilike '%pg_sleep%';"
  ], { encoding: 'utf8' });
  if (probe.stdout && probe.stdout.trim() === '1') {
    sleeping = true;
    break;
  }
  spawnSync('sleep', ['0.05']);
}
if (!sleeping) {
  console.error('beta hold did not keep its lock');
  process.exit(1);
}
const second = psqlAsync(`
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
select public.beta_reservation_hold('${RACE2}'::uuid, 'trainer') ->> 'cohort';
`);

Promise.all([first, second]).then(function (results) {
  results.forEach(function (res, i) {
    if (res.code !== 0) {
      console.error(res.out);
      console.error(res.err);
      process.exit(res.code || 1);
    }
    });
  const cohorts = results.map(function (res) {
    return res.out.trim().split('\n').filter(Boolean).pop();
  }).sort();
  if (cohorts[0] !== 'beta' || cohorts[1] !== 'standard') {
    console.error('race cohorts ' + cohorts.join(','));
    console.error(results[0].out);
    console.error(results[1].out);
    process.exit(1);
  }
  psql(DB, `
reset role;
do $$
declare n int; holds int;
begin
  select confirmed_count into n from public.beta_cohort_state;
  if n <> 99 then raise exception 'race changed confirmed_count to %', n; end if;
  select count(*) into holds from public.beta_reservations where status = 'held';
  if holds <> 1 then raise exception 'race left % holds', holds; end if;
end $$;
`);
  console.log('stripe billing sql ok');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
