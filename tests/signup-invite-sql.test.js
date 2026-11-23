// Sign-up links a client before approval. Local Postgres only.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261123020000_signup_invite.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
assert.ok(sqlText.indexOf('invite_attach') > 0);
assert.ok(sqlText.indexOf('raw_user_meta_data') > 0);
assert.ok(sqlText.indexOf('Your account is waiting for approval.') === -1);
assert.ok(sqlText.indexOf('invite_code') > 0);
assert.ok(sqlText.indexOf('trainerEmail') === -1);
assert.ok(sqlText.indexOf('p.email') === -1);

const TRAINER = '66666666-6666-4666-8666-666666666666';
const CLIENT = '77777777-7777-4777-8777-777777777777';
const BAD = '88888888-8888-4888-8888-888888888888';
const LATE = '99999999-9999-4999-8999-999999999999';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

psql('postgres', 'drop database if exists wb_signup_invite_test;\ncreate database wb_signup_invite_test;\n');
psql('wb_signup_invite_test', `
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`);
files.forEach(function (name) {
  psql('wb_signup_invite_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_signup_invite_test', null, path.join(root, migration));

const out = psql('wb_signup_invite_test', `
insert into auth.users (id, email) values ('${TRAINER}', 'coach@example.com');
update public.profiles
  set membership = 'trainer', access_approved = true, display_name = 'Coach Kim'
  where id = '${TRAINER}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${TRAINER}', false);
select set_config('app.signup_code', (public.invite_create()->>'code'), false);
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '${CLIENT}',
  'client@example.com',
  jsonb_build_object('invite_code', current_setting('app.signup_code'))
);

do $$
declare
  approved boolean;
  membership text;
  used_by uuid;
  links int;
begin
  select access_approved, p.membership into approved, membership
    from public.profiles p where id = '${CLIENT}';
  if approved is distinct from false then raise exception 'signup was approved'; end if;
  if membership is distinct from 'free_client' then raise exception 'signup membership %', membership; end if;
  select i.used_by into used_by from public.invites i where i.code = current_setting('app.signup_code');
  if used_by is distinct from '${CLIENT}' then raise exception 'code was not kept for this client'; end if;
  select count(*) into links from public.trainer_clients
    where trainer_id = '${TRAINER}' and client_id = '${CLIENT}' and ended_at is null;
  if links <> 1 then raise exception 'signup did not link, %', links; end if;
end $$;

update public.invites set expires_at = now() - interval '2 days'
  where code = current_setting('app.signup_code');

set role authenticated;
select set_config('request.jwt.claim.sub', '${CLIENT}', false);
do $$
declare result jsonb;
begin
  result := public.invite_redeem(current_setting('app.signup_code'));
  if result->>'message' not like '%Free Client%' then raise exception 'repeat said %', result; end if;
  if result::text like '%@%' then raise exception 'redeem leaked an email %', result; end if;
end $$;
reset role;
do $$
declare links int;
begin
  select count(*) into links from public.trainer_clients
    where client_id = '${CLIENT}' and ended_at is null;
  if links <> 1 then raise exception 'repeat added a link %', links; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '${CLIENT}', false);

do $$
begin
  perform public.invite_create();
  raise exception 'unapproved created an invite';
exception when others then
  if sqlerrm not like '%waiting for approval%' then raise exception 'create said %', sqlerrm; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email, raw_user_meta_data)
values ('${BAD}', 'bad@example.com', '{"invite_code":"ZZZZZZZZ"}'::jsonb);
do $$
declare n int; membership text;
begin
  select count(*) into n from public.profiles where id = '${BAD}';
  if n <> 1 then raise exception 'bad code blocked the account'; end if;
  select count(*) into n from public.trainer_clients where client_id = '${BAD}' and ended_at is null;
  if n <> 0 then raise exception 'bad code linked someone'; end if;
  select p.membership into membership from public.profiles p where id = '${BAD}';
  if membership is distinct from 'none' then raise exception 'bad code changed membership %', membership; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${TRAINER}', false);
select set_config('app.late_code', (public.invite_create()->>'code'), false);
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values ('${LATE}', 'late@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '${LATE}', false);
do $$
declare result jsonb; approved boolean;
begin
  result := public.invite_redeem(current_setting('app.late_code'), true);
  if result->>'message' not like '%Free Client%' then raise exception 'late redeem %', result; end if;
  if result->>'membership' is distinct from 'free_client' then raise exception 'late membership %', result; end if;
  select access_approved into approved from public.profiles where id = '${LATE}';
  if approved is distinct from false then raise exception 'late redeem approved the account'; end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '${TRAINER}', false);
do $$
declare roster jsonb;
begin
  roster := public.invite_roster();
  if roster::text like '%client@example.com%' or roster::text like '%late@example.com%' or roster::text like '%coach@example.com%' then
    raise exception 'roster showed an email %', roster;
  end if;
  if (roster->>'clientCount')::int <> 2 then raise exception 'roster count %', roster; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values ('${OTHER}', 'other@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '${OTHER}', false);
do $$
begin
  perform public.invite_redeem(current_setting('app.signup_code'));
  raise exception 'someone else reused the code';
exception when others then
  if sqlerrm not like '%That invite could not be used.%' then raise exception 'reuse said %', sqlerrm; end if;
end $$;
reset role;

do $$
declare can_run boolean; def text;
begin
  select has_function_privilege('authenticated', 'public.invite_attach(uuid, text, boolean)', 'execute') into can_run;
  if can_run then raise exception 'clients can call invite_attach'; end if;
  select has_function_privilege('anon', 'public.invite_attach(uuid, text, boolean)', 'execute') into can_run;
  if can_run then raise exception 'anon can call invite_attach'; end if;
  select pg_get_functiondef('public.invite_redeem(text, boolean)'::regprocedure) into def;
  if def like '%private.is_approved%' then raise exception 'redeem still waits for approval'; end if;
  if def not like '%invite_attach%' then raise exception 'redeem does not attach'; end if;
end $$;
`);

assert.ok(out.indexOf('ERROR') === -1);
psql('postgres', 'drop database if exists wb_signup_invite_test;\n');
console.log('signup invite sql ok');
