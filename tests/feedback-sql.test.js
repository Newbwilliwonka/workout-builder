// Feedback RLS, admin names, and the reply into Messages. Local Postgres only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'supabase/migrations/20261125180000_feedback.sql');
const sqlText = fs.readFileSync(file, 'utf8');
assert.ok(!/\bbegin\s*;/i.test(sqlText));
assert.ok(!/\bcommit\s*;/i.test(sqlText));
assert.ok(sqlText.includes("set search_path = ''"));
assert.ok(!sqlText.includes('pg_temp'));
assert.ok(sqlText.includes('security definer'));
assert.ok(sqlText.includes('private.is_admin()'));
assert.ok(sqlText.includes('default auth.uid()'));
assert.ok(sqlText.includes('user_id = (select auth.uid())'));
assert.ok(sqlText.includes("type in ('bug', 'idea', 'other')"));
assert.ok(sqlText.includes("status in ('new', 'replied', 'fixed')"));
assert.ok(sqlText.includes('char_length(message) between 1 and 2000'));
assert.ok(sqlText.includes('public.messages'));
assert.ok(sqlText.includes('public.feedback_reply'));
assert.ok(!/u\.email|p\.email|display_name,\s*\n\s*u\.email/i.test(sqlText));

const A = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const S = '44444444-4444-4444-8444-444444444444';
const LINKED = '55555555-5555-4555-8555-555555555555';

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

psql('postgres', 'drop database if exists wb_feedback_test;\ncreate database wb_feedback_test;\n');
psql('wb_feedback_test', `
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
migrations.forEach(function (name) {
  psql('wb_feedback_test', null, path.join(root, 'supabase/migrations', name));
});

const out = psql('wb_feedback_test', `
insert into auth.users (id, email) values
  ('${A}', 'kinisiathletics@gmail.com'),
  ('${C}', 'ada@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${LINKED}', 'linked@example.com');
update public.profiles set access_approved = true, membership = 'trainer', display_name = 'Kinisi Admin' where id = '${A}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Ada Client' where id = '${C}';
update public.profiles set access_approved = true, membership = 'enthusiast', display_name = 'stranger@example.com' where id = '${S}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Linked Client' where id = '${LINKED}';
insert into public.trainer_clients (trainer_id, client_id) values ('${A}', '${LINKED}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
insert into public.feedback (page, type, message) values ('Workouts', 'bug', 'The rest timer skips ahead.');
insert into public.feedback (page, type, message) values ('  Calendar  ', 'IDEA', '  A copy of last week.  ');

select set_config('request.jwt.claim.sub', '${S}', false);
insert into public.feedback (page, type, message) values ('Hub', 'other', 'Search is hard to find.');

do $$
declare n int;
begin
  if (select count(*) from public.feedback) <> 1 then
    raise exception 'stranger can read another person''s feedback';
  end if;
  if (select page from public.feedback) <> 'Hub' then
    raise exception 'stranger did not see only their own row';
  end if;
  select count(*) into n from public.feedback_admin;
  if n <> 0 then
    raise exception 'admin list is visible to a non-admin';
  end if;
  begin
    insert into public.feedback (user_id, page, type, message)
    values ('${C}', 'Workouts', 'bug', 'Pretending to be Ada');
    raise exception 'insert as someone else was allowed';
  exception when others then
    if sqlerrm not like '%own feedback%' then raise; end if;
  end;
  begin
    insert into public.feedback (page, type, message) values ('Workouts', 'nope', 'Bad type');
    raise exception 'bad type was allowed';
  exception when others then
    if sqlerrm not like '%Bug, Idea, or Other%' then raise; end if;
  end;
  begin
    perform public.feedback_reply(
      (select id from public.feedback where user_id = '${C}' limit 1),
      'Thanks'
    );
    raise exception 'non-admin reply was allowed';
  exception when others then
    if sqlerrm not like '%Only the admin%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${A}', false);
select display_name || '|' || page || '|' || type || '|' || status
from public.feedback_admin
order by created_at asc;
`);

assert.ok(out.indexOf('Ada Client|Workouts|bug|new') !== -1);
assert.ok(out.indexOf('Ada Client|Calendar|idea|new') !== -1);
assert.ok(out.indexOf('Enthusiast|Hub|other|new') !== -1);
assert.ok(out.indexOf('ada@example.com') === -1);
assert.ok(out.indexOf('stranger@example.com') === -1);

const cols = psql('wb_feedback_test', `
select string_agg(column_name, ',' order by ordinal_position)
from information_schema.columns
where table_schema = 'public' and table_name = 'feedback_admin';
`);
assert.ok(cols.indexOf('email') === -1);
assert.ok(cols.indexOf('display_name') !== -1);

psql('wb_feedback_test', `
set role authenticated;
select set_config('request.jwt.claim.sub', '${A}', false);

do $$
declare
  note uuid;
  linked uuid;
  n int;
begin
  select id into note from public.feedback where user_id = '${C}' and page = 'Workouts';
  perform public.feedback_reply(note, 'Thanks, we saw this.');
  if (select status from public.feedback where id = note) <> 'replied' then
    raise exception 'reply did not mark the row replied';
  end if;
  if (select replied_at from public.feedback where id = note) is null then
    raise exception 'reply did not stamp replied_at';
  end if;
  select count(*) into n from public.messages
  where sender_id = '${A}' and body = 'Thanks, we saw this.';
  if n <> 1 then
    raise exception 'reply did not write a message';
  end if;
  select count(*) into n from public.trainer_temp_links
  where trainer_id = '${A}' and client_id = '${C}' and ended_at is null;
  if n <> 1 then
    raise exception 'reply did not open a conversation';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.trainer_temp_links
  set expires_at = now() - interval '1 minute'
where trainer_id = '${A}' and client_id = '${C}' and ended_at is null;

set role authenticated;
select set_config('request.jwt.claim.sub', '${A}', false);

do $$
declare
  msg text;
  n int;
begin
  begin
    perform public.message_send('${C}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', 'This should be read only');
    raise exception 'expired conversation still accepted a direct send';
  exception when others then
    msg := sqlerrm;
    if msg not like '%read-only%' then
      raise exception 'expected read-only, got %', msg;
    end if;
  end;
  perform public.feedback_reply(
    (select id from public.feedback where user_id = '${C}' and page = 'Workouts'),
    'Following up after it expired.'
  );
  select count(*) into n from public.messages
  where sender_id = '${A}' and body = 'Following up after it expired.';
  if n <> 1 then
    raise exception 'expired reply did not write a message';
  end if;
  select count(*) into n from public.trainer_temp_links
  where trainer_id = '${A}' and client_id = '${C}' and ended_at is null and expires_at > now();
  if n <> 1 then
    raise exception 'expired reply did not open a fresh conversation';
  end if;
  select count(*) into n from public.trainer_temp_links
  where trainer_id = '${A}' and client_id = '${C}' and ended_at is not null;
  if n <> 1 then
    raise exception 'expired conversation was not closed';
  end if;
end $$;

do $$
declare linked uuid;
begin
  select id into linked from public.feedback where user_id = '${LINKED}';
  if linked is not null then
    raise exception 'unexpected linked feedback';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${LINKED}', false);
insert into public.feedback (page, type, message) values ('Messages', 'bug', 'Cannot open a thread.');

select set_config('request.jwt.claim.sub', '${A}', false);
select public.feedback_reply(
  (select id from public.feedback where user_id = '${LINKED}'),
  'Opened it for you.'
);

do $$
declare n int;
begin
  if (select count(*) from public.trainer_temp_links where client_id = '${LINKED}') <> 0 then
    raise exception 'an existing connection grew a second conversation';
  end if;
  select count(*) into n from public.messages
  where trainer_id = '${A}' and client_id = '${LINKED}' and body = 'Opened it for you.';
  if n <> 1 then
    raise exception 'reply did not use the existing connection';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
select body from public.messages where body = 'Thanks, we saw this.';
`);

const seen = psql('wb_feedback_test', `
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
select body from public.messages where sender_id = '${A}';
`);
assert.ok(seen.indexOf('Thanks, we saw this.') !== -1);
assert.ok(seen.indexOf('Following up after it expired.') !== -1);

psql('wb_feedback_test', `
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  update public.feedback set status = 'fixed' where user_id = '${C}';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'sender updated a row';
  end if;
  if exists (select 1 from public.feedback where user_id = '${C}' and status = 'fixed') then
    raise exception 'sender changed a status';
  end if;
end $$;
`);

console.log('FEEDBACK SQL OK');
