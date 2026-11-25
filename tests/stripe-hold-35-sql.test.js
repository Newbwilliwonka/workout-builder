// Beta hold refresh and session-specific release. Local Postgres only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261125220000_beta_hold_35_minutes.sql'), 'utf8');
assert.ok(migration.indexOf('greatest(expires_at, now() + interval \'35 minutes\')') !== -1);
assert.ok(migration.indexOf('security definer') !== -1);
assert.ok(migration.indexOf("set search_path = ''") !== -1);
assert.ok(migration.indexOf('grant execute on function public.beta_reservation_hold(uuid, text) to service_role') !== -1);
assert.ok(migration.indexOf('grant execute on function public.beta_reservation_release_current(uuid, text) to service_role') !== -1);

const USER = '44444444-4444-4444-8444-444444444444';
const DB = 'wb_hold35_test';

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
insert into auth.users (id, email) values ('${USER}', 'payer@example.com');
update public.profiles set access_approved = true, membership = 'none' where id = '${USER}';
`);

psql(DB, `
do $$
declare
  first jsonb;
  again jsonb;
  first_exp timestamptz;
  again_exp timestamptz;
  rid uuid;
  n int;
  seen text;
  session_id text;
  def text;
begin
  if has_function_privilege('authenticated', 'public.beta_reservation_release_current(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.beta_reservation_hold(uuid, text)', 'execute') then
    raise exception 'a signed-in person can run the Beta hold';
  end if;
  if not has_function_privilege('service_role', 'public.beta_reservation_hold(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.beta_reservation_release_current(uuid, text)', 'execute') then
    raise exception 'service role lost the Beta functions';
  end if;
  select pg_get_functiondef('public.beta_reservation_hold(uuid, text)'::regprocedure) into def;
  if position('security definer' in lower(def)) = 0
     or position('search_path to ' in lower(def)) = 0 then
    raise exception 'hold function lost its security settings';
  end if;

  first := public.beta_reservation_hold('${USER}'::uuid, 'enthusiast');
  rid := (first ->> 'reservation_id')::uuid;
  first_exp := (first ->> 'expires_at')::timestamptz;
  if first_exp < now() + interval '34 minutes' then
    raise exception 'new hold is shorter than 35 minutes: %', first_exp - now();
  end if;

  update public.beta_reservations
    set expires_at = now() + interval '1 minute'
    where id = rid;
  again := public.beta_reservation_hold('${USER}'::uuid, 'trainer');
  again_exp := (again ->> 'expires_at')::timestamptz;
  if (again ->> 'reservation_id')::uuid is distinct from rid then
    raise exception 'retry created a second hold';
  end if;
  if again_exp < now() + interval '34 minutes' then
    raise exception 'retry did not refresh the hold: %', again_exp - now();
  end if;
  select plan into seen from public.beta_reservations where id = rid;
  if seen is distinct from 'trainer' then raise exception 'retry kept the old plan'; end if;

  perform public.beta_reservation_attach(rid, 'cs_test_old');
  perform public.beta_reservation_attach(rid, 'cs_test_new');
  select checkout_session_id into session_id from public.beta_reservations where id = rid;
  if session_id is distinct from 'cs_test_new' then
    raise exception 'latest session was not stored: %', session_id;
  end if;

  n := public.beta_reservation_release_current(rid, 'cs_test_old');
  if n <> 0 then raise exception 'old session released the newer hold'; end if;
  select r.status into seen from public.beta_reservations r where r.id = rid;
  if seen is distinct from 'held' then raise exception 'hold was released by the old session'; end if;

  n := public.beta_reservation_release_current(rid, 'cs_test_new');
  if n <> 1 then raise exception 'current session did not release the hold'; end if;
  select r.status into seen from public.beta_reservations r where r.id = rid;
  if seen is distinct from 'released' then raise exception 'current session left the hold open'; end if;
end $$;
`);

console.log('stripe hold 35 sql ok');
