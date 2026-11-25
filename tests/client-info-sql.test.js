// Client info RLS and guard. Local Postgres only. Does not touch the live project.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'supabase/migrations/20261125030000_client_info.sql');
const sqlText = fs.readFileSync(file, 'utf8');
assert.ok(!/\bbegin\s*;/i.test(sqlText));
assert.ok(!/\bcommit\s*;/i.test(sqlText));
assert.ok(sqlText.includes("set search_path = ''"));
assert.ok(!sqlText.includes('pg_temp'));
assert.ok(sqlText.includes('security definer'));
assert.ok(sqlText.includes('ended_at is null'));
assert.ok(sqlText.includes('user_id = (select auth.uid())'));
assert.ok(sqlText.includes('Other goals cannot include an email.'));
assert.ok(!/birthday.*age|age integer/i.test(sqlText));

const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const S = '44444444-4444-4444-8444-444444444444';

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

psql('postgres', 'drop database if exists wb_client_info_test;\ncreate database wb_client_info_test;\n');
psql('wb_client_info_test', `
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
  'supabase/migrations/20261125030000_client_info.sql',
  'supabase/migrations/20261125030000_client_info.sql'
].forEach(function (rel) { psql('wb_client_info_test', null, path.join(root, rel)); });

psql('wb_client_info_test', `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set membership = 'trainer' where id = '${T}';
update public.profiles set membership = 'free_client' where id = '${C}';
update public.profiles set membership = 'enthusiast' where id = '${S}';
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
insert into public.client_info (user_id, birthday, sex, height_cm, weight_kg, goals, goals_other)
values ('${C}', '1996-11-25', 'female', 172.7, 68.039, array['Weight or fat loss','Other'], 'Track a 10k');

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare
  n int;
begin
  if (select count(*) from public.client_info) <> 1 then
    raise exception 'linked trainer could not read client info';
  end if;
  if (select goals_other from public.client_info) is distinct from 'Track a 10k' then
    raise exception 'trainer read the wrong note';
  end if;
  update public.client_info set weight_kg = 90 where user_id = '${C}';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'trainer updated client info';
  end if;
  begin
    insert into public.client_info (user_id, sex) values ('${C}', 'male');
    raise exception 'trainer inserted client info';
  exception when others then
    if SQLERRM like '%trainer inserted%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
begin
  if (select count(*) from public.client_info) <> 0 then
    raise exception 'stranger read client info';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  begin
    update public.client_info set goals_other = 'ada@example.com' where user_id = '${C}';
    raise exception 'email note saved';
  exception when others then
    if SQLERRM like '%email note saved%' then raise; end if;
    if SQLERRM not like '%Other goals cannot include an email.%' then raise; end if;
  end;
  if (select goals_other from public.client_info where user_id = '${C}') is distinct from 'Track a 10k' then
    raise exception 'rejected note replaced the saved text';
  end if;
  begin
    update public.client_info set goals_other = repeat('a', 121) where user_id = '${C}';
    raise exception 'long note saved';
  exception when others then
    if SQLERRM like '%long note saved%' then raise; end if;
    if SQLERRM not like '%at most 120%' then raise; end if;
  end;
  begin
    update public.client_info set birthday = current_date + 1 where user_id = '${C}';
    raise exception 'future birthday saved';
  exception when others then
    if SQLERRM like '%future birthday saved%' then raise; end if;
    if SQLERRM not like '%Birthday cannot be in the future.%' then raise; end if;
  end;
  begin
    update public.client_info set user_id = '${S}' where user_id = '${C}';
    raise exception 'client info was reassigned';
  exception when others then
    if SQLERRM like '%client info was reassigned%' then raise; end if;
  end;
end $$;

reset role;
update public.trainer_clients set ended_at = now() where trainer_id = '${T}' and client_id = '${C}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  if (select count(*) from public.client_info) <> 0 then
    raise exception 'ended trainer still read client info';
  end if;
end $$;

reset role;
set role anon;
do $$
begin
  begin
    perform 1 from public.client_info;
    raise exception 'anon read client info';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if (select proconfig::text from pg_proc where proname = 'client_info_guard') like '%pg_temp%' then
    raise exception 'client info guard searches pg_temp';
  end if;
  if (select count(*) from public.client_info where goals_other = 'Track a 10k') <> 1 then
    raise exception 'saved client info was lost';
  end if;
end $$;
`);

console.log('CLIENT INFO SQL OK');
