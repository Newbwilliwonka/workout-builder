// Paid Beta count. Local Postgres only. No holds.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261125230000_beta_paid_count.sql'), 'utf8');
assert.ok(migration.indexOf('security definer') !== -1);
assert.ok(migration.indexOf("set search_path = ''") !== -1);
assert.ok(migration.indexOf('private.billing_service_only()') !== -1);
assert.ok(migration.indexOf('grant execute on function public.beta_paid_count() to service_role') !== -1);
assert.ok(migration.indexOf('grant execute on function public.mark_beta_paid(uuid) to service_role') !== -1);
assert.ok(migration.indexOf("notify pgrst, 'reload schema'") !== -1);
assert.ok(!fs.existsSync(path.join(root, 'supabase/migrations/20261125220000_beta_hold_35_minutes.sql')));

const USER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const DB = 'wb_beta_count_test';

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

const files = fs.readdirSync(path.join(root, 'supabase/migrations'))
  .filter(function (name) { return name.endsWith('.sql'); })
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
files.forEach(function (name) {
  psql(DB, null, path.join(root, 'supabase/migrations', name));
});

psql(DB, `
insert into auth.users (id, email) values
  ('${USER}', 'payer@example.com'),
  ('${OTHER}', 'other@example.com');
`);

psql(DB, `
do $$
declare
  n integer;
  locked boolean;
begin
  if has_function_privilege('authenticated', 'public.beta_paid_count()', 'execute')
     or has_function_privilege('anon', 'public.beta_paid_count()', 'execute')
     or has_function_privilege('authenticated', 'public.mark_beta_paid(uuid)', 'execute')
     or has_function_privilege('anon', 'public.mark_beta_paid(uuid)', 'execute') then
    raise exception 'a signed-in person can count or lock Beta';
  end if;
  if not has_function_privilege('service_role', 'public.beta_paid_count()', 'execute')
     or not has_function_privilege('service_role', 'public.mark_beta_paid(uuid)', 'execute') then
    raise exception 'service role cannot count or lock Beta';
  end if;

  n := public.beta_paid_count();
  if n <> 0 then raise exception 'count started at %', n; end if;

  perform public.mark_beta_paid('${USER}'::uuid);
  perform public.mark_beta_paid('${USER}'::uuid);
  select beta_locked into locked from public.profiles where id = '${USER}';
  if locked is not true then raise exception 'paid Beta was not locked'; end if;
  n := public.beta_paid_count();
  if n <> 1 then raise exception 'repeat lock changed the count to %', n; end if;

  select beta_locked into locked from public.profiles where id = '${OTHER}';
  if locked then raise exception 'the other account was locked'; end if;

  if has_function_privilege('authenticated', 'public.checkout_claim(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.billing_write(uuid, text, text, text, text, text, timestamp with time zone, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.keep_paid_subscription(uuid, text, text, text, text, timestamp with time zone)', 'execute') then
    raise exception 'a signed-in person can claim Checkout or write billing';
  end if;
  if not has_function_privilege('service_role', 'public.checkout_claim(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.billing_write(uuid, text, text, text, text, text, timestamp with time zone, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.keep_paid_subscription(uuid, text, text, text, text, timestamp with time zone)', 'execute') then
    raise exception 'service role cannot claim Checkout or write billing';
  end if;

  if (public.checkout_claim('${USER}'::uuid, 'enthusiast') ->> 'granted')::boolean is not true then
    raise exception 'the first Checkout claim was refused';
  end if;
  if (public.checkout_claim('${USER}'::uuid, 'trainer') ->> 'granted')::boolean then
    raise exception 'a second Checkout claim was granted';
  end if;
end $$;
`);

psql(DB, `
do $$
declare
  result jsonb;
  sub text;
begin
  result := public.billing_write(
    '${USER}'::uuid, 'grant', 'enthusiast', null, 'cus_beta0001', 'sub_older001',
    now() + interval '30 days', true
  );
  if (result ->> 'duplicate')::boolean then
    raise exception 'first grant looked like a duplicate';
  end if;
  select stripe_subscription_id into sub from public.profiles where id = '${USER}';
  if sub is distinct from 'sub_older001' then
    raise exception 'grant stored %', sub;
  end if;

  result := public.billing_write(
    '${USER}'::uuid, 'grant', 'trainer', null, 'cus_beta0001', 'sub_newer001',
    now() + interval '30 days', false
  );
  if (result ->> 'duplicate')::boolean is not true
     or result ->> 'kept_subscription_id' is distinct from 'sub_older001' then
    raise exception 'duplicate grant returned %', result;
  end if;
  select stripe_subscription_id into sub from public.profiles where id = '${USER}';
  if sub is distinct from 'sub_older001' then
    raise exception 'duplicate grant changed the subscription to %', sub;
  end if;
end $$;
`);

console.log('stripe beta count sql ok');
