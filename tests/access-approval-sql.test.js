// Invite-only access and the audit security fixes. Local Postgres only.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261117180000_invite_only_access.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
assert.ok(sqlText.indexOf('private.is_approved') > 0);
assert.ok(sqlText.indexOf('gen_random_bytes(32)') > 0);
assert.ok(sqlText.indexOf('That invite could not be used.') > 0);
assert.ok(sqlText.indexOf('access_approved') > 0);
assert.ok(sqlText.indexOf('random()') === -1);
const lib = fs.readFileSync(path.join(root, 'vendor/supabase.js'));
assert.ok(lib.includes(Buffer.from('2.119.0')));
assert.ok(lib.length > 100000);
const auth = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
assert.ok(auth.indexOf('cdn.jsdelivr.net') === -1);
assert.ok(auth.indexOf('calendar_feed_save') > 0);
assert.ok(fs.readFileSync(path.join(root, 'index.html'), 'utf8').indexOf('vendor/supabase.js') > 0);
assert.ok(fs.readFileSync(path.join(root, 'app.js'), 'utf8').indexOf('at least 10 characters') > 0);

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const FAN = '44444444-4444-4444-8444-444444444444';
const PLAN = '55555555-5555-4555-8555-555555555555';
const TRAINER = '66666666-6666-4666-8666-666666666666';

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
  .filter(function (name) { return name.endsWith('.sql') && name < '20261117180000_invite_only_access.sql'; })
  .sort();

psql('postgres', 'drop database if exists wb_access_test;\ncreate database wb_access_test;\n');
psql('wb_access_test', `
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
  psql('wb_access_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_access_test', `insert into auth.users (id, email) values ('${OLD}', 'old@example.com');`);
psql('wb_access_test', null, path.join(root, migration));
psql('wb_access_test', `
insert into auth.users (id, email) values
  ('${NEW}', 'new@example.com'),
  ('${ADMIN}', 'kinisiathletics@gmail.com'),
  ('${FAN}', 'fan@example.com'),
  ('${PLAN}', 'plan@example.com'),
  ('${TRAINER}', 'coach@example.com');
update public.profiles set membership = 'enthusiast', display_name = 'Fan' where id = '${FAN}';
update public.profiles set membership = 'none', intended_plan = 'enthusiast', display_name = 'Plan' where id = '${PLAN}';
update public.profiles set membership = 'trainer', display_name = 'Coach', city = 'Austin', state = 'TX' where id = '${TRAINER}';
update public.profiles set email = 'stale-fan@example.com' where id = '${FAN}';
insert into public.exercises (id, name) values ('curl', 'Curl');
`);
psql('wb_access_test', null, path.join(root, migration));

const out = psql('wb_access_test', `
do $$
declare
  flag boolean;
  n int;
  token text;
  again text;
  rotated text;
  seen text;
  email text;
  def text;
  result jsonb;
  i int;
  code text;
begin
  select access_approved into flag from public.profiles where id = '${OLD}';
  if flag is not true then raise exception 'existing account was not approved'; end if;
  select access_approved into flag from public.profiles where id = '${NEW}';
  if flag is not false then raise exception 'new account was approved by a second run'; end if;
  if private.is_approved('${ADMIN}') is not true then raise exception 'admin is not approved'; end if;
  if private.is_approved('${NEW}') then raise exception 'new user counts as approved'; end if;

  select pg_get_functiondef('public.invite_make_code()'::regprocedure) into def;
  if position('gen_random_bytes' in def) = 0 or position('random()' in def) > 0 then
    raise exception 'invite codes still use random()';
  end if;
  if has_function_privilege('anon', 'public.invite_create()', 'execute')
     or has_function_privilege('public', 'public.invite_create()', 'execute')
     or has_function_privilege('anon', 'public.invite_cancel(text)', 'execute')
     or has_function_privilege('anon', 'public.invite_end(uuid)', 'execute')
     or has_function_privilege('anon', 'public.invite_roster()', 'execute')
     or has_function_privilege('anon', 'public.invite_mine()', 'execute') then
    raise exception 'anonymous role can run invite functions';
  end if;
  if has_function_privilege('authenticated', 'public.calendar_feed_for_token(text)', 'execute')
     or has_function_privilege('anon', 'public.calendar_feed_for_token(text)', 'execute') then
    raise exception 'calendar lookup is not service-only';
  end if;
  if not has_function_privilege('service_role', 'public.calendar_feed_for_token(text)', 'execute') then
    raise exception 'service role cannot look up calendar tokens';
  end if;

  select count(*) into n
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname <> 'profiles'
    and (
      (pg_get_expr(p.polqual, p.polrelid) is not null and pg_get_expr(p.polqual, p.polrelid) not like '%private.is_approved%')
      or (pg_get_expr(p.polwithcheck, p.polrelid) is not null and pg_get_expr(p.polwithcheck, p.polrelid) not like '%private.is_approved%')
    );
  if n <> 0 then raise exception 'app policies missing approval: %', n; end if;

  select count(*) into n
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'profiles'
    and (
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%private.is_approved%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%private.is_approved%'
    );
  if n <> 0 then raise exception 'own profile was locked behind approval'; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${NEW}', false);

do $$
declare n int; kept text; name text;
begin
  select count(*) into n from public.exercises;
  if n <> 0 then raise exception 'unapproved read the exercise library'; end if;
  select count(*) into n from public.access_accounts;
  if n <> 0 then raise exception 'unapproved read the access list'; end if;
  select count(*) into n from public.linked_profile_cards;
  if n <> 0 then raise exception 'unapproved read linked names'; end if;
  begin
    perform public.invite_create();
    raise exception 'unapproved created an invite';
  exception when others then
    if sqlerrm not like '%waiting for approval%' then raise exception 'invite create said %', sqlerrm; end if;
  end;
  begin
    perform public.account_workout_import(jsonb_build_object('localId', 'wo_1', 'name', 'Legs', 'items', '[]'::jsonb));
    raise exception 'unapproved imported a workout';
  exception when others then
    if sqlerrm not like '%waiting for approval%' then raise exception 'import said %', sqlerrm; end if;
  end;
  update public.profiles set email = 'hacked@example.com', display_name = 'New Person' where id = '${NEW}';
  select email, display_name into kept, name from public.profiles where id = '${NEW}';
  if kept is distinct from 'new@example.com' then raise exception 'email changed to %', kept; end if;
  if name is distinct from 'New Person' then raise exception 'name was not saved: %', name; end if;
  begin
    update public.profiles set access_approved = true where id = '${NEW}';
    raise exception 'unapproved set their own flag';
  exception when others then
    if sqlerrm not like '%cannot change access%' then raise exception 'flag change said %', sqlerrm; end if;
  end;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '${ADMIN}', false);

do $$
declare n int; seen text;
begin
  perform public.access_set('${NEW}', true);
  select count(*) into n from public.access_accounts where id = '${NEW}' and approved and email = 'new@example.com';
  if n <> 1 then raise exception 'admin list missed the new account'; end if;
  perform public.access_set('${NEW}', false);
  select count(*) into n from public.access_accounts where id = '${NEW}' and approved;
  if n <> 0 then raise exception 'remove access did not clear approval'; end if;
  select count(*) into n from public.access_accounts where email like '%@%';
  if n < 1 then raise exception 'admin could not see emails'; end if;
end $$;

reset role;
update public.profiles set access_approved = true where id = '${FAN}';
update public.profiles set access_approved = true where id = '${TRAINER}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${FAN}', false);

do $$
declare i int; result jsonb; n int; token text; again text; rotated text; code text;
begin
  for i in 1..6 loop
    result := public.account_workout_import(jsonb_build_object(
      'localId', 'wo_' || i, 'name', 'Workout ' || i, 'items', '[]'::jsonb
    ));
    if coalesce((result->>'created')::boolean, false) is not true then
      raise exception 'import % did not create', i;
    end if;
  end loop;
  begin
    perform public.account_workout_import(jsonb_build_object(
      'localId', 'wo_7', 'name', 'Extra', 'items', '[]'::jsonb
    ));
    raise exception 'import raised the cap';
  exception when others then
    if sqlerrm not like '%up to 6 workouts%' then raise exception 'seventh import said %', sqlerrm; end if;
  end;
  select count(*) into n from public.account_workouts where owner_id = '${FAN}' and deleted_at is null;
  if n <> 6 then raise exception 'enthusiast stored %', n; end if;

  result := public.calendar_feed_save('America/Guayaquil', false);
  token := result->>'token';
  if token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'token was not generated'; end if;
  result := public.calendar_feed_save('UTC', false);
  again := result->>'token';
  if again is distinct from token then raise exception 'save rotated the token'; end if;
  if (result->>'time_zone') is distinct from 'UTC' then raise exception 'zone was not saved'; end if;
  result := public.calendar_feed_save('America/Guayaquil', true);
  rotated := result->>'token';
  if rotated = token or rotated !~ '^[0-9a-f]{64}$' then raise exception 'reset did not mint a new token'; end if;

  begin
    perform public.invite_redeem('NOPE');
    raise exception 'bad invite succeeded';
  exception when others then
    if sqlerrm not like '%That invite could not be used.%' then raise exception 'redeem said %', sqlerrm; end if;
  end;
end $$;

update public.calendar_feeds set token = repeat('b', 64) where user_id = '${FAN}';
do $$
declare kept text;
begin
  select token into kept from public.calendar_feeds where user_id = '${FAN}';
  if kept = repeat('b', 64) then raise exception 'client token was stored'; end if;
  if kept !~ '^[0-9a-f]{64}$' then raise exception 'token was cleared'; end if;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '${PLAN}', false);
do $$
begin
  update public.profiles set access_approved = true where id = '${PLAN}';
exception when others then
  null;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set access_approved = true where id = '${PLAN}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${PLAN}', false);
do $$
begin
  perform public.account_workout_import(jsonb_build_object(
    'localId', 'wo_plan', 'name', 'Plan only', 'items', '[]'::jsonb
  ));
  raise exception 'selected plan saved a workout';
exception when others then
  if sqlerrm not like '%Could not save that workout.%' then raise exception 'plan import said %', sqlerrm; end if;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '${TRAINER}', false);
do $$
declare code text; result jsonb;
begin
  result := public.invite_create();
  code := result->>'code';
  if code is null or code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'code shape %', code;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.invites set expires_at = now() - interval '1 minute' where trainer_id = '${TRAINER}';
select set_config('app.test_code', (select code from public.invites where trainer_id = '${TRAINER}' limit 1), false);
update public.profiles set access_approved = true where id = '${OLD}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${OLD}', false);
do $$
declare msg text;
begin
  begin
    perform public.invite_redeem(current_setting('app.test_code'));
    raise exception 'expired invite was redeemed';
  exception when others then
    msg := sqlerrm;
  end;
  if msg not like '%That invite could not be used.%' then raise exception 'expired redeem said %', msg; end if;
  begin
    perform public.invite_redeem('ZZZZZZZZ');
    raise exception 'missing invite was redeemed';
  exception when others then
    msg := sqlerrm;
  end;
  if msg not like '%That invite could not be used.%' then raise exception 'missing redeem said %', msg; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set membership = 'master_trainer' where id = '${FAN}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${FAN}', false);
insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
values ('${FAN}', 'NASM', 'A-1', current_date + 30);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '${ADMIN}', false);
do $$
declare seen text;
begin
  select email into seen from public.verification_queue where user_id = '${FAN}';
  if seen is distinct from 'fan@example.com' then raise exception 'queue email was %', seen; end if;
end $$;

reset role;
do $$
declare feed jsonb; token text;
begin
  select c.token into token from public.calendar_feeds c where c.user_id = '${FAN}';
  execute 'set role service_role';
  feed := public.calendar_feed_for_token(token);
  if feed is null or feed->>'timezone' is null then raise exception 'approved feed was hidden'; end if;
  reset role;
  update public.profiles set access_approved = false where id = '${FAN}';
  execute 'set role service_role';
  feed := public.calendar_feed_for_token(token);
  if feed is not null then raise exception 'unapproved feed still resolved'; end if;
  reset role;
end $$;
`);

assert.ok(out.indexOf('ERROR') === -1);
console.log('access approval sql ok');
