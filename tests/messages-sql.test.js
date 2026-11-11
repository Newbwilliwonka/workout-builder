// RLS and idempotent send against local Postgres. Does not touch the live project.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const MSG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MSG2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function psql(db, sql, file) {
  const args = ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', db];
  const opts = { encoding: 'utf8' };
  if (file) args.push('-f', file);
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

psql('postgres', 'drop database if exists wb_messages_test;\ncreate database wb_messages_test;\n');
psql('wb_messages_test', `
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create publication supabase_realtime;
`);
psql('wb_messages_test', null, path.join(root, 'supabase/migrations/20261106150000_profiles.sql'));
psql('wb_messages_test', null, path.join(root, 'supabase/migrations/20261107160000_invites.sql'));
psql('wb_messages_test', null, path.join(root, 'supabase/migrations/20261111120000_messages.sql'));
psql('wb_messages_test', null, path.join(root, 'supabase/migrations/20261111120000_messages.sql'));

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set membership = 'trainer' where id = '${T}';
update public.profiles set membership = 'free_client' where id = '${C}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast' where id = '${E}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}');

do $$
declare n int; ident "char";
begin
  select count(*) into n from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages';
  if n <> 1 then raise exception 'realtime publication count %', n; end if;
  select relreplident into ident from pg_class where relname = 'messages';
  if ident <> 'f' then raise exception 'replica identity %', ident; end if;
end $$;

-- Free client sends, then retries the same id with a different body.
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int; body text; sent jsonb;
begin
  if public.message_threads()->>'role' <> 'client' then
    raise exception 'client role %', public.message_threads();
  end if;
  sent := public.message_send('${T}', '${MSG}', '  hello  ');
  if sent->>'body' <> 'hello' then raise exception 'trim failed %', sent; end if;
  if sent->>'id' <> '${MSG}' then raise exception 'id not kept %', sent; end if;
  sent := public.message_send('${T}', '${MSG}', 'hello again');
  if sent->>'body' <> 'hello' then raise exception 'retry changed body %', sent; end if;
  select count(*) into n from public.messages where id = '${MSG}';
  if n <> 1 then raise exception 'duplicate row %', n; end if;
  select m.body into body from public.messages m where m.id = '${MSG}';
  if body <> 'hello' then raise exception 'stored %', body; end if;
end $$;

-- Enthusiast has a separate thread. The free client cannot see it.
select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare n int;
begin
  perform public.message_send('${T}', '${MSG2}', 'Thursday?');
  select count(*) into n from public.messages;
  if n <> 1 then raise exception 'enthusiast saw % messages', n; end if;
  begin
    perform public.message_open('${C}');
    raise exception 'enthusiast opened the other client';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
end $$;

-- Trainer sees both threads even if invite_role is not granted to signed-in users.
reset role;
revoke execute on function public.invite_role(public.profiles) from public, anon, authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare threads jsonb; opened jsonb; n int;
begin
  threads := public.message_threads();
  if threads->>'role' <> 'trainer' then raise exception 'role %', threads; end if;
  if (select count(*) from jsonb_array_elements(threads->'threads')) <> 2 then
    raise exception 'threads %', threads;
  end if;
  select elem->>'unread' into n from jsonb_array_elements(threads->'threads') elem
    where elem->>'id' = '${E}';
  if n::int <> 1 then raise exception 'enthusiast unread %', n; end if;
  opened := public.message_open('${C}');
  if position('hello' in opened::text) = 0 then raise exception 'missing hello %', opened; end if;
  if position('Thursday' in opened::text) <> 0 then raise exception 'leaked other thread %', opened; end if;
  perform public.message_read('${E}');
  select elem->>'unread' into n from jsonb_array_elements(public.message_threads()->'threads') elem
    where elem->>'id' = '${E}';
  if n::int <> 0 then raise exception 'still unread %', n; end if;
  begin
    update public.messages set body = 'hacked' where id = '${MSG}';
    raise exception 'body update should fail';
  exception when others then
    if sqlerrm not like '%Only read state%' then raise; end if;
  end;
  update public.messages set read_at = now() where id = '${MSG}' and sender_id <> auth.uid();
  if not found then raise exception 'trainer could not mark the client message read'; end if;
end $$;

-- Sender cannot mark their own message, and a stranger cannot read or write.
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  update public.messages set read_at = now() where id = '${MSG2}';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'client updated another thread'; end if;
  begin
    perform public.message_send('${E}', gen_random_uuid(), 'nope');
    raise exception 'client messaged the other client';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.messages;
  if n <> 0 then raise exception 'stranger saw %', n; end if;
  if public.message_threads()->'threads' <> '[]'::jsonb then
    raise exception 'stranger threads %', public.message_threads();
  end if;
  begin
    perform public.message_send('${T}', gen_random_uuid(), 'hi');
    raise exception 'stranger send should fail';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
  begin
    insert into public.messages (id, trainer_id, client_id, sender_id, body)
    values (gen_random_uuid(), '${T}', '${C}', '${S}', 'direct');
    raise exception 'stranger insert should fail';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set role anon;
do $$
begin
  perform 1 from public.messages;
  raise exception 'anon read should fail';
exception when insufficient_privilege then
  null;
end $$;

-- Ending the link hides the thread and blocks a new send. Rows remain.
reset role;
update public.trainer_clients set ended_at = now() where client_id = '${C}';
select count(*) as kept from public.messages where client_id = '${C}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  select count(*) into n from public.messages;
  if n <> 0 then raise exception 'ended link still visible %', n; end if;
  begin
    perform public.message_send('${T}', gen_random_uuid(), 'after');
    raise exception 'send after disconnect should fail';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
  begin
    perform public.message_open('${T}');
    raise exception 'open after disconnect should fail';
  exception when others then
    if sqlerrm not like '%no connection%' then raise; end if;
  end;
  if public.message_threads()->'threads' <> '[]'::jsonb then
    raise exception 'thread still listed %', public.message_threads();
  end if;
end $$;

reset role;
do $$
declare n int;
begin
  select count(*) into n from public.messages where client_id = '${C}';
  if n <> 1 then raise exception 'disconnect deleted messages %', n; end if;
  select count(*) into n from public.messages where body = 'after';
  if n <> 0 then raise exception 'disconnect still inserted'; end if;
end $$;
`;

const out = psql('wb_messages_test', assertSql);
if (!/kept[\s\S]*1/.test(out) && !/\n\s*1\s*\n/.test(out)) {
  console.log(out);
}
fs.writeFileSync('/tmp/messages-sql.out', out);
console.log(out.trim().split('\n').slice(-8).join('\n'));
console.log('MESSAGES SQL OK');
