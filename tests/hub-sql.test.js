// Trainer Hub tables, RLS, rate limits, and privacy. Local Postgres only.
// Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261118190000_trainer_hub.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
[
  'private.hub_events',
  'public.hub_posts',
  'public.hub_replies',
  'public.hub_reports',
  'public.hub_feed',
  'public.hub_reply_feed',
  'public.hub_report_queue',
  'private.hub_author',
  'You can post again in a little while.',
  'You can reply again in a little while.',
  'You can report again in a little while.',
  'private.is_approved',
  'private.is_admin()',
  'security_barrier = true',
  'hub_posts_activity_idx',
  'hub_replies_post_idx',
  'hub_reports_open_idx'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(sqlText.indexOf('raw_user_meta_data') === -1);
assert.ok(!/author_email|profiles\.email|u\.email/.test(sqlText));

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COACH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const JO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WAIT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const POST = '11111111-1111-4111-8111-111111111111';
const POST2 = '22222222-2222-4222-8222-222222222222';
const REPLY = '33333333-3333-4333-8333-333333333333';

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

const earlier = fs.readdirSync(path.join(root, 'supabase/migrations'))
  .filter(function (name) { return name.endsWith('.sql') && name < '20261118190000_trainer_hub.sql'; })
  .sort();

psql('postgres', 'drop database if exists wb_hub_test;\ncreate database wb_hub_test;\n');
psql('wb_hub_test', `
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
earlier.forEach(function (name) {
  psql('wb_hub_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_hub_test', `
insert into auth.users (id, email) values
  ('${ADMIN}', 'kinisiathletics@gmail.com'),
  ('${COACH}', 'coach@example.com'),
  ('${ADA}', 'ada@example.com'),
  ('${JO}', 'jo@example.com'),
  ('${WAIT}', 'wait@example.com');
update public.profiles set access_approved = true, membership = 'master_trainer', display_name = 'Coach Kim', verified_until = current_date + 30 where id = '${COACH}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'ada@example.com' where id = '${ADA}';
update public.profiles set access_approved = true, membership = 'enthusiast', display_name = 'Jo Park' where id = '${JO}';
update public.profiles set access_approved = false, membership = 'trainer', display_name = 'Pat Wait' where id = '${WAIT}';
`);
psql('wb_hub_test', null, path.join(root, migration));
psql('wb_hub_test', null, path.join(root, migration));

const assertSql = `
set role authenticated;
select set_config('request.jwt.claim.sub', '${WAIT}', false);
do $$
begin
  begin
    insert into public.hub_posts (id, author_id, title, body)
    values ('${POST}', '${WAIT}', 'Hello', 'From a waiting account');
    raise exception 'waiting account inserted a post';
  exception when others then
    if sqlerrm not like '%waiting for approval%' and sqlerrm not like '%row-level security%' then
      raise;
    end if;
  end;
  if (select count(*) from public.hub_feed) <> 0 then
    raise exception 'waiting account read the feed';
  end if;
  if (select count(*) from public.hub_posts) <> 0 then
    raise exception 'waiting account read posts';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${JO}', false);
do $$
declare n int; seen text;
begin
  insert into public.hub_posts (id, author_id, title, body)
  values ('${POST}', '${JO}', '  Deload weeks  ', '  How do you <script>alert(1)</script> plan them?  ');
  select title, body into seen, seen from public.hub_posts where id = '${POST}';
  if (select title from public.hub_posts where id = '${POST}') <> 'Deload weeks' then
    raise exception 'title was not trimmed';
  end if;
  if (select body from public.hub_posts where id = '${POST}') <> 'How do you <script>alert(1)</script> plan them?' then
    raise exception 'body was not stored as text';
  end if;
  if (select author_name from public.hub_feed where id = '${POST}') <> 'Jo Park' then
    raise exception 'author name %', (select author_name from public.hub_feed where id = '${POST}');
  end if;
  if (select author_role from public.hub_feed where id = '${POST}') <> 'Enthusiast' then
    raise exception 'author role';
  end if;
  begin
    insert into public.hub_posts (id, author_id, title, body)
    values ('${POST2}', '${COACH}', 'Stolen', 'Not me');
    raise exception 'posted as someone else';
  exception when others then
    if sqlerrm not like '%only post as yourself%' and sqlerrm not like '%row-level security%' then
      raise;
    end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${ADA}', false);
do $$
declare feed text;
begin
  select author_name || ' ' || author_role into feed from public.hub_feed where id = '${POST}';
  if feed <> 'Jo Park Enthusiast' then raise exception 'ada feed %', feed; end if;
  if position('@' in (select coalesce(string_agg(hub_feed::text, ' '), '') from public.hub_feed)) > 0 then
    raise exception 'feed leaked an email';
  end if;
  insert into public.hub_replies (id, post_id, author_id, body)
  values ('${REPLY}', '${POST}', '${ADA}', '  I keep the main lifts.  ');
  if (select author_name from public.hub_reply_feed where id = '${REPLY}') <> 'Client' then
    raise exception 'email display name was shown';
  end if;
  if (select author_role from public.hub_reply_feed where id = '${REPLY}') <> 'Free Client' then
    raise exception 'free client role';
  end if;
  if position('@' in (select hub_reply_feed::text from public.hub_reply_feed where id = '${REPLY}')) > 0 then
    raise exception 'reply feed leaked an email';
  end if;
  begin
    update public.hub_posts set title = 'Hacked' where id = '${POST}';
  exception when others then
    null;
  end;
  if (select title from public.hub_posts where id = '${POST}') <> 'Deload weeks' then
    raise exception 'ada edited jo''s post';
  end if;
  begin
    insert into public.hub_reports (reporter_id, post_id, reply_id)
    values ('${ADA}', '${POST}', '${REPLY}');
    raise exception 'reported own reply';
  exception when others then
    if sqlerrm not like '%cannot report your own reply%' then raise; end if;
  end;
  insert into public.hub_reports (reporter_id, post_id) values ('${ADA}', '${POST}');
  begin
    insert into public.hub_reports (reporter_id, post_id) values ('${ADA}', '${POST}');
    raise exception 'reported twice';
  exception when others then
    if sqlerrm not like '%already reported%' then raise; end if;
  end;
  if (select count(*) from public.hub_reports) <> 0 then
    raise exception 'ada read the reports table';
  end if;
  if (select count(*) from public.hub_report_queue) <> 0 then
    raise exception 'ada read the report queue';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${COACH}', false);
do $$
declare name text; role text; verified boolean; activity timestamptz; other timestamptz;
begin
  if (select author_name from public.hub_reply_feed where id = '${REPLY}') <> 'Client' then
    raise exception 'coach saw an email name';
  end if;
  insert into public.hub_posts (id, author_id, title, body)
  values ('${POST2}', '${COACH}', 'Saturday strength', 'Bring a rack.');
  select activity_at into other from public.hub_posts where id = '${POST2}';
  select activity_at into activity from public.hub_posts where id = '${POST}';
  if activity >= other then raise exception 'reply did not sort after the newer post before another reply'; end if;
  insert into public.hub_replies (id, post_id, author_id, body)
  values ('44444444-4444-4444-8444-444444444444', '${POST}', '${COACH}', 'Keep the squats.');
  select activity_at into activity from public.hub_posts where id = '${POST}';
  if activity < other then raise exception 'reply did not move the post'; end if;
  select author_name, author_role, author_verified into name, role, verified
  from public.hub_feed where id = '${POST2}';
  if name <> 'Coach Kim' or role <> 'Master Trainer' or verified is not true then
    raise exception 'coach card % % %', name, role, verified;
  end if;
  update public.hub_posts set title = 'Saturday strength block' where id = '${POST2}';
  if (select title from public.hub_posts where id = '${POST2}') <> 'Saturday strength block' then
    raise exception 'author could not edit';
  end if;
  if (select count(*) from public.hub_report_queue) <> 0 then
    raise exception 'coach read reports';
  end if;
end $$;

-- The author of a post cannot delete the report on it. Deleting the post still does.
select set_config('request.jwt.claim.sub', '${JO}', false);
insert into public.hub_reports (reporter_id, post_id) values ('${JO}', '${POST2}');
delete from public.hub_reports where post_id = '${POST}';
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.hub_reports where post_id = '${POST}' and status = 'open';
  if n <> 1 then raise exception 'author erased a report %', n; end if;
  select count(*) into n from public.hub_reports where post_id = '${POST2}' and status = 'open';
  if n <> 1 then raise exception 'report on the second post %', n; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '${COACH}', false);
delete from public.hub_reports where post_id = '${POST2}';
delete from public.hub_posts where id = '${POST2}';
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.hub_reports where post_id = '${POST2}';
  if n <> 0 then raise exception 'deleting the post left reports %', n; end if;
  select count(*) into n from public.hub_reports where post_id = '${POST}' and status = 'open';
  if n <> 1 then raise exception 'the other report changed %', n; end if;
end $$;
set role authenticated;

-- Five posts are allowed. The sixth is refused, even with an old timestamp.
select set_config('request.jwt.claim.sub', '${JO}', false);
do $$
declare i int; new_id uuid;
begin
  for i in 1..4 loop
    new_id := (
      substr(md5(i::text), 1, 8) || '-1111-4111-8111-' || substr(md5(i::text), 1, 12)
    )::uuid;
    insert into public.hub_posts (id, author_id, title, body, created_at)
    values (new_id, '${JO}', 'Extra ' || i, 'Body ' || i, now() - interval '3 days');
  end loop;
  begin
    insert into public.hub_posts (id, author_id, title, body, created_at)
    values ('55555555-5555-4555-8555-555555555555', '${JO}', 'Too many', 'Stop', now() - interval '3 days');
    raise exception 'sixth post was stored';
  exception when others then
    if sqlerrm not like '%a little while%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${ADMIN}', false);
do $$
declare seen text; n int;
begin
  if (select count(*) from public.hub_report_queue) <> 1 then
    raise exception 'admin queue %', (select count(*) from public.hub_report_queue);
  end if;
  select author_name || '|' || author_role || '|' || reporter_name || '|' || title into seen
  from public.hub_report_queue;
  if seen <> 'Jo Park|Enthusiast|Client|Deload weeks' then
    raise exception 'queue row %', seen;
  end if;
  if position('@' in (select hub_report_queue::text from public.hub_report_queue)) > 0 then
    raise exception 'queue leaked an email';
  end if;
  update public.hub_reports set status = 'dismissed' where post_id = '${POST}' and reply_id is null;
  if (select count(*) from public.hub_report_queue) <> 0 then
    raise exception 'dismissed report still open';
  end if;
  delete from public.hub_posts where id = '${POST}';
  if (select count(*) from public.hub_posts where id = '${POST}') <> 0 then
    raise exception 'admin delete left the post';
  end if;
  if (select count(*) from public.hub_replies where post_id = '${POST}') <> 0 then
    raise exception 'admin delete left replies';
  end if;
  if (select count(*) from public.hub_reports where post_id = '${POST}') <> 0 then
    raise exception 'admin delete left reports';
  end if;
  select count(*) into n from pg_policy where polname = 'hub_posts_select';
  if n <> 1 then raise exception 'policy duplicated %', n; end if;
end $$;

reset role;
do $$
declare n int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('hub_feed', 'hub_reply_feed', 'hub_report_queue')
      and column_name ilike '%email%'
  ) then
    raise exception 'hub view has an email column';
  end if;
  select count(*) into n from pg_indexes
  where indexname in (
    'hub_posts_activity_idx', 'hub_posts_author_idx', 'hub_replies_post_idx',
    'hub_replies_author_idx', 'hub_reports_open_idx', 'hub_events_recent_idx'
  );
  if n <> 6 then raise exception 'indexes %', n; end if;
end $$;

set role anon;
do $$
begin
  begin
    perform count(*) from public.hub_feed;
    raise exception 'anon read the feed';
  exception when insufficient_privilege then
    null;
  end;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${COACH}', false);
do $$
begin
  begin
    perform count(*) from private.hub_events;
    raise exception 'read the rate log';
  exception when insufficient_privilege then
    null;
  end;
end $$;
`;

psql('wb_hub_test', assertSql);
console.log('hub sql ok');
