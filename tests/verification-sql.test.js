// Verification requests, admin review, and the seal date. Local Postgres only.
// Does not touch the live project.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'supabase/migrations/20261115140000_master_trainer_verification.sql');
const sqlText = fs.readFileSync(file, 'utf8');
assert.ok(sqlText.indexOf('verification_requests') > 0);
assert.ok(sqlText.indexOf('private.is_admin()') > 0);
assert.ok(sqlText.indexOf('kinisiathletics@gmail.com') > 0);
assert.ok(sqlText.indexOf('verified_until') > 0);
assert.ok(sqlText.indexOf('trainer_verified') > 0);
assert.ok(sqlText.indexOf('verification_queue') > 0);
assert.ok(sqlText.indexOf('security_barrier = true') > 0);
assert.ok(sqlText.indexOf("raw_user_meta_data") === -1);

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

psql('postgres', 'drop database if exists wb_verify_test;\ncreate database wb_verify_test;\n');
psql('wb_verify_test', `
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
  'supabase/migrations/20261111120000_messages.sql',
  'supabase/migrations/20261111140000_workout_copies.sql',
  'supabase/migrations/20261111160000_share_own.sql',
  'supabase/migrations/20261115002700_profile_details.sql',
  'supabase/migrations/20261115140000_master_trainer_verification.sql',
  'supabase/migrations/20261115140000_master_trainer_verification.sql'
].forEach(function (rel) { psql('wb_verify_test', null, path.join(root, rel)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${A}', 'KinisiAthletics@gmail.com'),
  ('${M}', 'master@example.com'),
  ('${C}', 'ada@example.com'),
  ('${T}', 'coach@example.com');
update public.profiles set membership = 'trainer', email = 'kinisiathletics@gmail.com' where id = '${A}';
update public.profiles set membership = 'master_trainer', email = 'master@example.com', display_name = 'Coach Kim', online_only = true where id = '${M}';
update public.profiles set membership = 'free_client', email = 'ada@example.com', display_name = 'Ada' where id = '${C}';
update public.profiles set membership = 'trainer', email = 'coach@example.com', display_name = 'Pat', online_only = true where id = '${T}';
insert into public.trainer_clients (trainer_id, client_id) values ('${M}', '${C}');

do $$
declare cols text;
begin
  select string_agg(column_name, ',' order by column_name) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'trainer_verified';
  if cols <> 'id,verified' then raise exception 'verified columns %', cols; end if;
  if not has_table_privilege('authenticated', 'public.trainer_verified', 'select') then
    raise exception 'signed-in users cannot read who is verified';
  end if;
  if has_table_privilege('authenticated', 'public.admins', 'select') then
    raise exception 'admin list is readable';
  end if;
  if has_table_privilege('authenticated', 'public.trainer_directory', 'select') then
    raise exception 'trainer search is granted too early';
  end if;
  if has_table_privilege('anon', 'public.verification_requests', 'select') then
    raise exception 'anon can read requests';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
set role authenticated;

insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
values ('${M}', '  NASM  ', '  A-100  ', current_date + 30);

do $$
declare n int; body text; until date;
begin
  select count(*) into n from public.verification_requests;
  if n <> 1 then raise exception 'owner cannot read own request'; end if;
  select cert_body into body from public.verification_requests where user_id = '${M}';
  if body <> 'NASM' then raise exception 'body not trimmed %', body; end if;
  update public.profiles set verified_until = current_date + 90 where id = '${M}';
  select verified_until into until from public.profiles where id = '${M}';
  if until is not null then raise exception 'trainer set verified_until %', until; end if;
  begin
    insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
    values ('${M}', 'ACE', 'B-2', current_date + 10);
    raise exception 'second pending insert worked';
  exception when others then
    if sqlerrm not like '%pending%' then raise; end if;
  end;
  begin
    insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
    values ('${C}', 'ACE', 'B-2', current_date + 10);
    raise exception 'inserted for someone else';
  exception when others then
    if sqlerrm not like '%Sign in%' and sqlerrm not like '%row-level%' and sqlerrm not like '%policy%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  begin
    insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
    values ('${T}', 'ACE', 'B-2', current_date + 10);
    raise exception 'regular trainer submitted';
  exception when others then
    if sqlerrm not like '%Master Trainer%' then raise; end if;
  end;
  if (select count(*) from public.verification_requests) <> 0 then
    raise exception 'trainer read another request';
  end if;
  if (select count(*) from public.verification_queue) <> 0 then
    raise exception 'trainer saw the queue';
  end if;
  if private.is_admin() then raise exception 'trainer is admin'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare seen boolean;
begin
  if (select count(*) from public.verification_requests) <> 0 then
    raise exception 'client read the request';
  end if;
  if (select count(*) from public.trainer_verified) <> 0 then
    raise exception 'seal is visible before approval';
  end if;
  update public.verification_requests set status = 'approved' where user_id = '${M}';
  if found then raise exception 'client approved the request'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${A}', false);
do $$
declare n int; note text; until date; seen boolean; flagged boolean;
begin
  if not private.is_admin() then raise exception 'admin was not recognized'; end if;
  select count(*) into n from public.verification_queue;
  if n <> 1 then raise exception 'queue count %', n; end if;
  if (select display_name from public.verification_queue) <> 'Coach Kim' then
    raise exception 'queue name';
  end if;
  if (select email from public.verification_queue) <> 'master@example.com' then
    raise exception 'queue email';
  end if;
  if (select cert_body from public.verification_queue) <> 'NASM' then raise exception 'queue body'; end if;
  if (select cert_number from public.verification_queue) <> 'A-100' then raise exception 'queue number'; end if;
  begin
    update public.verification_requests set status = 'declined', admin_note = '   ' where user_id = '${M}';
    raise exception 'blank note declined';
  exception when others then
    if sqlerrm not like '%Enter a note%' then raise; end if;
  end;
  update public.verification_requests
    set status = 'declined', admin_note = '  Number does not match. '
    where user_id = '${M}' and status = 'pending';
  select admin_note into note from public.verification_requests where user_id = '${M}';
  if note <> 'Number does not match.' then raise exception 'note %', note; end if;
  select verified_until into until from public.profiles where id = '${M}';
  if until is not null then raise exception 'decline set a seal %', until; end if;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
values ('${M}', 'ACE', 'Z-9', current_date + 40);

do $$
begin
  begin
    insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
    values ('${M}', 'ACE', 'Z-9', current_date);
    raise exception 'today was accepted';
  exception when others then
    if sqlerrm not like '%future%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${A}', false);
update public.verification_requests
  set status = 'approved'
  where user_id = '${M}' and status = 'pending';

do $$
declare until date; seen boolean; mine jsonb; threads jsonb; flagged text;
begin
  select verified_until into until from public.profiles where id = '${M}';
  if until <> current_date + 40 then raise exception 'seal date %', until; end if;
  select verified into seen from public.trainer_verified where id = '${M}';
  if seen is not true then raise exception 'directory flag'; end if;
  select verified::text into flagged from public.linked_profile_cards where id = '${M}';
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare seen boolean; link jsonb; threads jsonb; flagged text;
begin
  select verified into seen from public.trainer_verified where id = '${M}';
  if seen is not true then raise exception 'client cannot see the seal'; end if;
  if (select count(*) from public.verification_requests) <> 0 then
    raise exception 'client read submissions after approval';
  end if;
  link := public.invite_mine();
  if link->>'trainerName' <> 'Coach Kim' then raise exception 'trainer name %', link; end if;
  if (link->>'verified')::boolean is not true then raise exception 'invite verified %', link; end if;
  threads := public.message_threads();
  select elem->>'verified' into flagged
    from jsonb_array_elements(threads->'threads') elem
    where elem->>'id' = '${M}';
  if flagged <> 'true' then raise exception 'message verified %', flagged; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set verified_until = current_date - 1 where id = '${M}';

select set_config('request.jwt.claim.sub', '${C}', false);
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.trainer_verified where id = '${M}';
  if n <> 0 then raise exception 'expired seal still shows'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
values ('${M}', 'NASM', 'A-200', current_date + 5);

reset role;
select status from public.verification_requests where cert_number = 'A-200';
`;

const out = psql('wb_verify_test', assertSql);
if (out.indexOf('pending') === -1) {
  console.error(out);
  process.exit(1);
}
console.log('verification sql ok');
