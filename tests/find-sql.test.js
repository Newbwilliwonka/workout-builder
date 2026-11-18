// Trainer search, requests, and temporary conversations. Local Postgres only.
// Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261118210000_trainer_find.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
[
  'private.trainer_activity_score',
  'public.trainer_requests',
  'public.trainer_temp_links',
  'public.trainer_search',
  'public.message_can_send',
  'You already have 3 open requests.',
  'You can request this trainer again later.',
  'This conversation is read-only.',
  'interval \'7 days\'',
  'interval \'30 days\'',
  'interval \'30 days\'',
  'p_lat',
  'p_lng',
  'comingSoon',
  'private.is_approved',
  'profiles_listed_idx',
  'trainer_requests_one_open',
  'trainer_temp_one_open'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(sqlText.indexOf('raw_user_meta_data') === -1);
assert.ok(!/trainer_email|client_email|profiles\.email|u\.email/.test(sqlText));

const AMY = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const CARA = '33333333-3333-4333-8333-333333333333';
const DEE = '44444444-4444-4444-8444-444444444444';
const NIA = '55555555-5555-4555-8555-555555555555';
const QUINN = '66666666-6666-4666-8666-666666666666';
const SAM = '77777777-7777-4777-8777-777777777777';
const UMA = '88888888-8888-4888-8888-888888888888';
const VAL = '99999999-9999-4999-8999-999999999999';
const WES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const XIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ZOE1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ZOE2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const C1 = '12121212-1212-4121-8121-121212121212';
const C2 = '13131313-1313-4131-8131-131313131313';
const F1 = '14141414-1414-4141-8141-141414141414';
const F2 = '15151515-1515-4151-8151-151515151515';
const WAIT = '17171717-1717-4171-8171-171717171717';
const POST = '18181818-1818-4181-8181-181818181818';
const MSG = '19191919-1919-4191-8191-191919191919';

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

psql('postgres', 'drop database if exists wb_find_test;\ncreate database wb_find_test;\n');
psql('wb_find_test', `
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
files.forEach(function (name) {
  psql('wb_find_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_find_test', null, path.join(root, migration));

const people = [
  [AMY, 'amy@example.com', 'Amy Coach', 'master_trainer', true, 'both', true],
  [BEA, 'bea@example.com', 'Bea Coach', 'trainer', true, 'online', false],
  [CARA, 'cara@example.com', 'Cara Coach', 'trainer', true, 'in_person', false],
  [DEE, 'dee@example.com', 'Dee Coach', 'trainer', false, 'online', false],
  [NIA, 'nia@example.com', 'Nia Coach', 'trainer', true, 'online', false],
  [QUINN, 'quinn@example.com', 'Quinn Coach', 'trainer', true, 'online', false],
  [SAM, 'sam-t@example.com', 'Sam Coach', 'trainer', true, 'online', false],
  [UMA, 'uma@example.com', 'Uma Coach', 'trainer', true, 'online', false],
  [VAL, 'val@example.com', 'Val Coach', 'trainer', true, 'online', false],
  [WES, 'wes@example.com', 'Wes Coach', 'trainer', true, 'online', false],
  [XIO, 'xio@example.com', 'Xio Coach', 'trainer', true, 'online', false],
  [ZED, 'zed@example.com', 'Zed Coach', 'trainer', true, 'online', false],
  [ZOE1, 'zoe1@example.com', 'Zoe One', 'trainer', true, 'online', false],
  [ZOE2, 'zoe2@example.com', 'Zoe Two', 'trainer', true, 'online', false],
  [C1, 'ada@example.com', 'Ada Lee', 'free_client', false, null, false],
  [C2, 'linked@example.com', 'Linked Client', 'free_client', false, null, false],
  [F1, 'fill1@example.com', 'Fill One', 'free_client', false, null, false],
  [F2, 'fill2@example.com', 'Fill Two', 'free_client', false, null, false],
  [WAIT, 'wait@example.com', 'Pat Wait', 'free_client', false, null, false]
];

psql('wb_find_test', `
insert into auth.users (id, email) values
${people.map(function (row) { return `('${row[0]}', '${row[1]}')`; }).join(',\n')};
${people.map(function (row) {
  const service = row[5] ? `'${row[5]}'` : 'null';
  const until = row[6] ? 'current_date + 30' : 'null';
  return `update public.profiles set access_approved = true, membership = '${row[3]}', display_name = '${row[2]}', online_only = true, listed = ${row[4]}, service_type = ${service}, verified_until = ${until} where id = '${row[0]}';`;
}).join('\n')}
update public.profiles set access_approved = false where id = '${WAIT}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${AMY}', '${C2}'),
  ('${AMY}', '${F1}'),
  ('${AMY}', '${F2}');
insert into public.hub_posts (id, author_id, title, body, created_at) values
  ('${POST}', '${AMY}', 'Recent', 'A recent post', now() - interval '1 day'),
  ('${BEA}', '${BEA}', 'One', 'First', now() - interval '2 days'),
  ('${NIA}', '${BEA}', 'Two', 'Second', now() - interval '3 days'),
  ('${ZED}', '${ZED}', 'Old', 'Too old to count', now() - interval '40 days');
insert into public.hub_replies (id, post_id, author_id, body, created_at) values
  ('${QUINN}', '${POST}', '${BEA}', 'A reply', now() - interval '1 day');
`);

const out = psql('wb_find_test', `
do $$
declare n int;
begin
  if has_function_privilege('anon', 'public.trainer_search(text, double precision, double precision)', 'execute')
     or has_function_privilege('anon', 'public.trainer_request_send(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.trainer_request_decide(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.message_can_send(uuid, uuid)', 'execute') then
    raise exception 'anonymous role can search or request';
  end if;
  if has_table_privilege('anon', 'public.trainer_requests', 'select')
     or has_table_privilege('authenticated', 'public.trainer_requests', 'insert')
     or has_table_privilege('authenticated', 'public.trainer_temp_links', 'insert') then
    raise exception 'request tables are writable or public';
  end if;
  select count(*) into n
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname in ('trainer_requests', 'trainer_temp_links')
    and (
      pg_get_expr(p.polqual, p.polrelid) not like '%private.is_approved%'
      or pg_get_expr(p.polwithcheck, p.polrelid) is not null
    );
  if n <> 0 then raise exception 'request policies are not read-only and approved'; end if;
  if private.trainer_activity_score('${AMY}'::uuid) <> 4 then
    raise exception 'amy score %', private.trainer_activity_score('${AMY}'::uuid);
  end if;
  if private.trainer_activity_score('${BEA}'::uuid) <> 3 then
    raise exception 'bea score %', private.trainer_activity_score('${BEA}'::uuid);
  end if;
  if private.trainer_activity_score('${ZED}'::uuid) <> 0 then
    raise exception 'old post counted %', private.trainer_activity_score('${ZED}'::uuid);
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);

do $$
declare
  result jsonb;
  names text;
  near jsonb;
begin
  result := public.trainer_search('online', null, null);
  if result->>'mode' <> 'online' or result->>'comingSoon' <> 'false' then
    raise exception 'online shape %', result;
  end if;
  if position('@' in result::text) > 0 then raise exception 'search leaked an email %', result; end if;
  if jsonb_array_length(result->'trainers') <> 10 then
    raise exception 'expected 10 trainers, got %', result->'trainers';
  end if;
  select string_agg(item->>'name', '|' order by ord) into names
  from jsonb_array_elements(result->'trainers') with ordinality as t(item, ord);
  if names <> 'Amy Coach|Bea Coach|Nia Coach|Quinn Coach|Sam Coach|Uma Coach|Val Coach|Wes Coach|Xio Coach|Zed Coach' then
    raise exception 'rank %', names;
  end if;
  if result::text like '%Cara Coach%' or result::text like '%Dee Coach%' or result::text like '%Zoe %' then
    raise exception 'included someone who should be hidden %', names;
  end if;
  if (result->'trainers'->0->>'verified')::boolean is not true then
    raise exception 'amy should be verified';
  end if;
  if (result->'trainers'->1->>'verified')::boolean then
    raise exception 'bea should not be verified';
  end if;
  if result->'trainers'->0->>'serviceType' <> 'both' or result->'trainers'->1->>'serviceType' <> 'online' then
    raise exception 'service types %', result->'trainers';
  end if;
  if result->'trainers'->0->>'role' <> 'Master Trainer' or result->'trainers'->1->>'role' <> 'Trainer' then
    raise exception 'roles %', result->'trainers';
  end if;
  near := public.trainer_search('near', 30.2, -97.7);
  if near->>'comingSoon' <> 'true' or jsonb_array_length(near->'trainers') <> 0 then
    raise exception 'near me should be empty %', near;
  end if;
  if position('@' in near::text) > 0 then raise exception 'near leaked an email'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C2}', false);
do $$
declare result jsonb;
begin
  result := public.trainer_search('online', null, null);
  if result::text like '%Amy Coach%' then raise exception 'linked trainer was listed'; end if;
  if jsonb_array_length(result->'trainers') <> 10 then
    raise exception 'linked search count %', result->'trainers';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${BEA}', false);
do $$
begin
  begin
    perform public.trainer_search('online', null, null);
    raise exception 'trainer searched';
  exception when others then
    if sqlerrm not like '%clients and enthusiasts%' then raise exception 'trainer search said %', sqlerrm; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${WAIT}', false);
do $$
begin
  begin
    perform public.trainer_search('online', null, null);
    raise exception 'waiting account searched';
  exception when others then
    if sqlerrm not like '%waiting for approval%' then raise exception 'waiting search said %', sqlerrm; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare row jsonb;
begin
  begin
    update public.profiles set listed = true, service_type = 'online' where id = '${C1}';
    raise exception 'client opted in';
  exception when others then
    if sqlerrm not like '%Only a Trainer or Master Trainer%' then raise exception 'client list said %', sqlerrm; end if;
  end;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '${VAL}', false);
do $$
begin
  begin
    update public.profiles set listed = true, service_type = null where id = '${VAL}';
    raise exception 'listed without a service';
  exception when others then
    if sqlerrm not like '%Choose in person, online, or both%' then raise exception 'service said %', sqlerrm; end if;
  end;
  update public.profiles set listed = false, service_type = 'in_person' where id = '${VAL}';
  if (select listed from public.profiles where id = '${VAL}') then
    raise exception 'switch did not turn off';
  end if;
  update public.profiles set listed = true, service_type = 'both' where id = '${VAL}';
  if (select service_type from public.profiles where id = '${VAL}') <> 'both' then
    raise exception 'service was not saved';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare sent jsonb; box jsonb; n int;
begin
  sent := public.trainer_request_send('${BEA}'::uuid, '  Hello <script>alert(1)</script>  ');
  if sent->>'status' <> 'open' then raise exception 'request status %', sent; end if;
  if sent->>'note' <> 'Hello <script>alert(1)</script>' then raise exception 'note stored %', sent->>'note'; end if;
  perform public.trainer_request_send('${QUINN}'::uuid, null);
  perform public.trainer_request_send('${SAM}'::uuid, '');
  begin
    perform public.trainer_request_send('${UMA}'::uuid, 'fourth');
    raise exception 'fourth request was accepted';
  exception when others then
    if sqlerrm not like '%3 open requests%' then raise exception 'cap said %', sqlerrm; end if;
  end;
  select count(*) into n from public.trainer_requests where client_id = '${C1}' and status = 'open';
  if n <> 3 then raise exception 'open count %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${BEA}', false);
do $$
declare box jsonb;
begin
  box := public.trainer_request_inbox();
  if jsonb_array_length(box) <> 1 then raise exception 'inbox %', box; end if;
  if position('@' in box::text) > 0 then raise exception 'inbox leaked an email %', box; end if;
  if box->0->>'name' <> 'Ada Lee' or box->0->>'role' <> 'Free Client' then
    raise exception 'inbox person %', box->0;
  end if;
  if box->0->>'note' <> 'Hello <script>alert(1)</script>' then
    raise exception 'inbox note %', box->0->>'note';
  end if;
  if public.trainer_request_count() <> 1 then raise exception 'count %', public.trainer_request_count(); end if;
  perform public.trainer_request_decide((box->0->>'id')::uuid, false);
  if public.trainer_request_count() <> 0 then raise exception 'decline left the request open'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
begin
  begin
    perform public.trainer_request_send('${BEA}'::uuid, 'again');
    raise exception 'cooldown did not hold';
  exception when others then
    if sqlerrm not like '%again later%' then raise exception 'cooldown said %', sqlerrm; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C2}', false);
do $$
begin
  begin
    perform public.trainer_request_send('${AMY}'::uuid, 'hi');
    raise exception 'request to a linked trainer was accepted';
  exception when others then
    if sqlerrm not like '%already connected%' then raise exception 'linked request said %', sqlerrm; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.trainer_requests
  set decided_at = now() - interval '31 days'
  where trainer_id = '${BEA}' and client_id = '${C1}' and status = 'declined';

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare n int; threads jsonb; opened jsonb; linked boolean;
begin
  -- Two requests are still open (Quinn, Sam). Bea can be requested again.
  perform public.trainer_request_send('${BEA}'::uuid, 'after a month');
  select count(*) into n from public.trainer_requests
    where client_id = '${C1}' and trainer_id = '${BEA}' and status = 'open';
  if n <> 1 then raise exception 'bea was not requested again'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${QUINN}', false);
do $$
declare req uuid; decided jsonb; threads jsonb; opened jsonb; linked boolean; roster jsonb;
begin
  select id into req from public.trainer_requests
    where trainer_id = '${QUINN}' and client_id = '${C1}' and status = 'open';
  decided := public.trainer_request_decide(req, true);
  if decided->>'status' <> 'approved' or decided->>'expiresAt' is null then
    raise exception 'approve %', decided;
  end if;
  select public.profile_is_linked('${C1}'::uuid) into linked;
  if linked then raise exception 'temporary link can read the client profile'; end if;
  roster := public.invite_roster();
  if roster::text like '%ada@example.com%' or roster::text like '%${C1}%' then
    raise exception 'temporary client is on the client list %', roster;
  end if;
  threads := public.message_threads();
  if position('@' in threads::text) > 0 then raise exception 'threads leaked an email %', threads; end if;
  if threads->'threads'->0->>'temporary' <> 'true'
     or threads->'threads'->0->>'canSend' <> 'true'
     or (threads->'threads'->0->>'daysLeft')::int < 1
     or threads->'threads'->0->>'name' <> 'Ada Lee' then
    raise exception 'temp thread %', threads->'threads';
  end if;
  perform public.message_send('${C1}'::uuid, '${MSG}'::uuid, 'See you this week');
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare opened jsonb;
begin
  opened := public.message_open('${QUINN}'::uuid);
  if opened->'person'->>'temporary' <> 'true' or opened->'person'->>'canSend' <> 'true' then
    raise exception 'client thread %', opened->'person';
  end if;
  if opened->'person'->>'name' <> 'Quinn Coach' then raise exception 'trainer name %', opened->'person'; end if;
  if position('@' in opened::text) > 0 then raise exception 'open leaked an email'; end if;
  if opened->'messages'->0->>'body' <> 'See you this week' then raise exception 'missing message %', opened->'messages'; end if;
  perform public.message_send('${QUINN}'::uuid, '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a'::uuid, 'Thanks');
  begin
    perform public.trainer_request_send('${QUINN}'::uuid, 'again');
    raise exception 'requested a trainer during an active conversation';
  exception when others then
    if sqlerrm not like '%already have a conversation%' then
      raise exception 'active conversation request said %', sqlerrm;
    end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.trainer_temp_links
  set expires_at = now() - interval '1 minute'
  where trainer_id = '${QUINN}' and client_id = '${C1}' and ended_at is null and converted_at is null;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare opened jsonb; n int;
begin
  if public.message_can_send('${QUINN}'::uuid, '${C1}'::uuid) then
    raise exception 'expired conversation can still send';
  end if;
  if not public.message_live('${QUINN}'::uuid, '${C1}'::uuid) then
    raise exception 'expired conversation is hidden';
  end if;
  opened := public.message_open('${QUINN}'::uuid);
  if opened->'person'->>'canSend' <> 'false' or (opened->'person'->>'daysLeft')::int <> 0 then
    raise exception 'expired person %', opened->'person';
  end if;
  if opened->'messages'->0->>'body' <> 'See you this week' and opened->'messages'->1->>'body' <> 'See you this week' then
    raise exception 'history missing %', opened->'messages';
  end if;
  begin
    perform public.message_send('${QUINN}'::uuid, '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b'::uuid, 'too late');
    raise exception 'sent after expiry';
  exception when others then
    if sqlerrm not like '%read-only%' then raise exception 'expiry send said %', sqlerrm; end if;
  end;
  begin
    insert into public.messages (id, trainer_id, client_id, sender_id, body)
    values ('1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c', '${QUINN}', '${C1}', '${C1}', 'direct');
    raise exception 'direct insert after expiry';
  exception when others then
    if sqlerrm not like '%read-only%' and sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then
      raise exception 'direct insert said %', sqlerrm;
    end if;
  end;
  select count(*) into n from public.messages
    where trainer_id = '${QUINN}' and client_id = '${C1}' and body = 'See you this week';
  if n <> 1 then raise exception 'history was removed'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${QUINN}', false);
do $$
declare code text;
begin
  code := public.invite_create()->>'code';
  perform set_config('wb.code', code, false);
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare threads jsonb; opened jsonb;
begin
  perform public.invite_redeem(current_setting('wb.code'), true);
  threads := public.message_threads();
  if threads::text like '%"temporary": true%' and threads::text like '%Quinn%' then
    raise exception 'converted thread still temporary %', threads->'threads';
  end if;
  opened := public.message_open('${QUINN}'::uuid);
  if opened->'person'->>'temporary' <> 'false' or opened->'person'->>'canSend' <> 'true' then
    raise exception 'permanent person %', opened->'person';
  end if;
  if opened::text not like '%See you this week%' then raise exception 'history dropped after redeem'; end if;
  perform public.message_send('${QUINN}'::uuid, '1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d'::uuid, 'Now a client');
end $$;

-- Early end is a different pair, so the converted Quinn thread stays intact.
select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare n int;
begin
  -- Free a slot if three are open, then ask Wes.
  select count(*) into n from public.trainer_requests where client_id = '${C1}' and status = 'open';
  if n >= 3 then
    raise exception 'still at the request cap before wes: %', n;
  end if;
  perform public.trainer_request_send('${WES}'::uuid, 'short');
end $$;

select set_config('request.jwt.claim.sub', '${WES}', false);
do $$
declare req uuid;
begin
  select id into req from public.trainer_requests
    where trainer_id = '${WES}' and client_id = '${C1}' and status = 'open';
  perform public.trainer_request_decide(req, true);
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
begin
  perform public.trainer_temp_end('${WES}'::uuid);
  begin
    perform public.message_open('${WES}'::uuid);
    raise exception 'ended conversation still opens';
  exception when others then
    if sqlerrm not like '%no connection%' then raise exception 'ended open said %', sqlerrm; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  if exists (
    select 1 from public.trainer_clients
    where trainer_id = '${QUINN}' and client_id = '${C1}' and ended_at is null
  ) then
    null;
  else
    raise exception 'redeem did not create the permanent link';
  end if;
  if exists (
    select 1 from public.trainer_temp_links
    where trainer_id = '${QUINN}' and client_id = '${C1}' and converted_at is null and ended_at is null
  ) then
    raise exception 'temporary link was not converted';
  end if;
  if exists (
    select 1 from public.trainer_clients
    where trainer_id = '${WES}' and client_id = '${C1}' and ended_at is null
  ) then
    raise exception 'ending a temporary link created a client';
  end if;
  if exists (
    select 1 from public.trainer_clients
    where trainer_id = '${WES}' and client_id = '${C1}'
  ) then
    raise exception 'a temporary conversation wrote a client row';
  end if;
end $$;
`);

if (!/find sql ok|DO/.test(out) && out.indexOf('ERROR') !== -1) {
  console.error(out);
  process.exit(1);
}
console.log('find sql ok');
