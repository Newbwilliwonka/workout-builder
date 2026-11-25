// Nav badge counts and own-row seen stamps. Local Postgres only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'supabase/migrations/20261125040000_nav_badges.sql');
const sqlText = fs.readFileSync(file, 'utf8');
assert.ok(!/\bbegin\s*;/i.test(sqlText));
assert.ok(!/\bcommit\s*;/i.test(sqlText));
assert.ok(sqlText.includes("set search_path = ''"));
assert.ok(!sqlText.includes('pg_temp'));
assert.ok(sqlText.includes('security invoker'));
assert.ok(sqlText.includes('user_id = (select auth.uid())'));
assert.ok(!/email/i.test(sqlText));

const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const O = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const POST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const POST2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const REPLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const REPLY2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const REPLY3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const MSG = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const MSG2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';

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

psql('postgres', 'drop database if exists wb_nav_badges_test;\ncreate database wb_nav_badges_test;\n');
psql('wb_nav_badges_test', `
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
  psql('wb_nav_badges_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_nav_badges_test', null, file);

psql('wb_nav_badges_test', `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${O}', 'other@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set access_approved = true, membership = 'trainer', display_name = 'Coach Kim' where id = '${T}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Ada Client' where id = '${C}';
update public.profiles set access_approved = true, membership = 'enthusiast', display_name = 'Other Person' where id = '${O}';
update public.profiles set access_approved = true, membership = 'free_client', display_name = 'Stranger' where id = '${S}';
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int; unread int;
begin
  if public.nav_badges() <> '{"messages":0,"hub":0,"tracking":0}'::jsonb then
    raise exception 'empty badges %', public.nav_badges();
  end if;

  perform set_config('request.jwt.claim.sub', '${T}', true);
  perform public.message_send('${C}'::uuid, '${MSG}'::uuid, 'Your plan is ready');
  perform set_config('request.jwt.claim.sub', '${C}', true);
  select (public.nav_badges()->>'messages')::int into n;
  if n <> 1 then raise exception 'unread message %', n; end if;
  select elem->>'unread' into unread from jsonb_array_elements(public.message_threads()->'threads') elem
    where elem->>'id' = '${T}';
  if unread::int <> 1 then raise exception 'thread unread %', unread; end if;

  perform public.nav_mark_seen('messages');
  select (public.nav_badges()->>'messages')::int into n;
  if n <> 0 then raise exception 'opening messages left %', n; end if;
  select elem->>'unread' into unread from jsonb_array_elements(public.message_threads()->'threads') elem
    where elem->>'id' = '${T}';
  if unread::int <> 1 then raise exception 'opening messages marked it read %', unread; end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
select public.message_send('${C}'::uuid, '${MSG2}'::uuid, 'One more note');
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select (public.nav_badges()->>'messages')::int into n;
  if n <> 1 then raise exception 'new unread %', n; end if;
  perform public.message_read('${T}'::uuid);
  select (public.nav_badges()->>'messages')::int into n;
  if n <> 0 then raise exception 'read message still counted %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
insert into public.hub_posts (id, author_id, title, body)
values ('${POST}', '${C}', 'Deload week', 'How do you plan it?');
select set_config('request.jwt.claim.sub', '${O}', false);
insert into public.hub_posts (id, author_id, title, body)
values ('${POST2}', '${O}', 'Shoes', 'Which shoes?');
insert into public.hub_replies (id, post_id, author_id, body)
values ('${REPLY}', '${POST}', '${O}', 'Keep the main lifts.');
select set_config('request.jwt.claim.sub', '${C}', false);
insert into public.hub_replies (id, post_id, author_id, body)
values ('${REPLY2}', '${POST}', '${C}', 'Thanks.');
insert into public.hub_replies (id, post_id, author_id, body)
values ('${REPLY3}', '${POST2}', '${C}', 'I like the flat ones.');

do $$
declare n int;
begin
  select (public.nav_badges()->>'hub')::int into n;
  if n <> 1 then raise exception 'hub replies %', n; end if;
  perform public.nav_mark_seen('hub');
  select (public.nav_badges()->>'hub')::int into n;
  if n <> 0 then raise exception 'opening hub left %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${O}', false);
insert into public.hub_replies (id, post_id, author_id, body)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', '${POST}', '${O}', 'And sleep.');
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select (public.nav_badges()->>'hub')::int into n;
  if n <> 1 then raise exception 'reply after opening hub %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
values ('${C}', '${T}', 'Coach Kim', '2026-11-25', '[{"type":"plan"}]'::jsonb);
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int; sid uuid;
begin
  select (public.nav_badges()->>'tracking')::int into n;
  if n <> 1 then raise exception 'unopened share %', n; end if;
  select id into sid from public.shared_dashboards where client_id = '${C}' order by created_at limit 1;
  update public.shared_dashboards set viewed_at = now() where id = sid;
  select (public.nav_badges()->>'tracking')::int into n;
  if n <> 0 then raise exception 'opened share still counted %', n; end if;
  perform public.nav_mark_seen('tracking');
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
values ('${C}', '${T}', 'Coach Kim', '2026-11-26', '[{"type":"workouts"}]'::jsonb);
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select (public.nav_badges()->>'tracking')::int into n;
  if n <> 1 then raise exception 'share after opening tracking %', n; end if;
  begin
    perform public.nav_mark_seen('nope');
    raise exception 'bad section was stored';
  exception when others then
    if sqlerrm not like '%not available%' then raise; end if;
  end;
  begin
    insert into public.nav_seen (user_id) values ('${T}');
    raise exception 'client wrote the trainer row';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%violates%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.nav_seen;
  if n <> 0 then raise exception 'stranger read seen rows %', n; end if;
  begin
    update public.nav_seen set messages_at = now() where user_id = '${C}';
    if found then raise exception 'stranger updated the row'; end if;
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  begin
    update public.nav_seen set hub_at = now() where user_id = '${C}';
    if found then raise exception 'trainer updated the client row'; end if;
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  if position('@' in public.nav_badges()::text) > 0 then
    raise exception 'badges leaked an email';
  end if;
end $$;
`);

console.log('NAV BADGES SQL OK');
