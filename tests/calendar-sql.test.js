// Calendar feed tokens and who each token includes. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const M = '88888888-8888-4888-8888-888888888888';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const F = '55555555-5555-4555-8555-555555555555';
const X = '66666666-6666-4666-8666-666666666666';
const TT = 'a'.repeat(64);
const CT = 'b'.repeat(64);
const ET = 'c'.repeat(64);
const MT = 'd'.repeat(64);
const NT = '9'.repeat(64);

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

psql('postgres', 'drop database if exists wb_calendar_test;\ncreate database wb_calendar_test;\n');
psql('wb_calendar_test', `
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin;
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
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`);
[
  'supabase/migrations/20261106150000_profiles.sql',
  'supabase/migrations/20261107160000_invites.sql',
  'supabase/migrations/20261111120000_messages.sql',
  'supabase/migrations/20261111140000_workout_copies.sql',
  'supabase/migrations/20261111160000_share_own.sql',
  'supabase/migrations/20261111180000_programs.sql',
  'supabase/migrations/20261111223000_program_times.sql',
  'supabase/migrations/20261112120000_trainer_own_program.sql',
  'supabase/migrations/20261112150000_calendar_feeds.sql',
  'supabase/migrations/20261112150000_calendar_feeds.sql'
].forEach(function (file) { psql('wb_calendar_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com'),
  ('${F}', 'free2@example.com'),
  ('${X}', 'ended@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'master_trainer', email = 'master@example.com' where id = '${M}';
update public.profiles set membership = 'free_client', email = 'ada@example.com', display_name = 'Jane' where id = '${C}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'fan@example.com', share_with_trainer = false where id = '${E}';
update public.profiles set membership = 'free_client', email = 'free2@example.com' where id = '${F}';
update public.profiles set membership = 'free_client', email = 'ended@example.com', display_name = 'Ended' where id = '${X}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}');
insert into public.trainer_clients (trainer_id, client_id, ended_at) values
  ('${T}', '${X}', now());
insert into public.trainer_clients (trainer_id, client_id) values
  ('${M}', '${F}');

insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, items, day, presence, starts_at, ends_at) values
  ('${T}', 'own1', 'wo-own', 'Coach day', '[]'::jsonb, '2026-11-12', 'solo', '07:00', '08:00'),
  ('${C}', 'jane-with', 'wo-j', 'Morning lift', '[]'::jsonb, '2026-11-12', 'trainer', '09:00', '10:30'),
  ('${C}', 'jane-solo', 'wo-s', 'Easy day', '[]'::jsonb, '2026-11-12', 'solo', '15:00', '16:00'),
  ('${E}', 'fan-with', 'wo-f', 'Fan lift', '[]'::jsonb, '2026-11-13', 'trainer', '06:00', '07:00'),
  ('${E}', 'fan-own', 'wo-fo', 'Fan solo', '[]'::jsonb, '2026-11-13', 'solo', null, null),
  ('${F}', 'free-with', 'wo-fr', 'Free lift', '[]'::jsonb, '2026-11-14', 'trainer', '11:00', '12:00'),
  ('${X}', 'ended-with', 'wo-x', 'Ended lift', '[]'::jsonb, '2026-11-12', 'trainer', '12:00', '13:00'),
  ('${S}', 'stranger', 'wo-st', 'Secret lift', '[]'::jsonb, '2026-11-12', 'trainer', '12:00', '13:00');

insert into public.calendar_feeds (user_id, token, time_zone) values
  ('${T}', '${TT}', 'America/Guayaquil'),
  ('${C}', '${CT}', 'America/Guayaquil'),
  ('${E}', '${ET}', 'America/New_York'),
  ('${M}', '${MT}', 'America/Guayaquil');

do $$
declare
  feed jsonb;
  dash text := ' ' || chr(8211) || ' ';
  n int;
begin
  feed := public.calendar_feed_for_token('${TT}');
  if feed is null then raise exception 'trainer feed missing'; end if;
  if feed ? 'token' or feed ? 'user_id' then raise exception 'trainer feed leaked the token'; end if;
  if feed->>'timezone' is distinct from 'America/Guayaquil' then raise exception 'trainer zone %', feed->>'timezone'; end if;
  if feed::text like '%${TT}%' then raise exception 'token echoed'; end if;
  if feed::text like '%${C}%' then raise exception 'client id leaked'; end if;
  select count(*) into n from jsonb_array_elements(feed->'events');
  if n <> 2 then raise exception 'trainer event count before share %', feed; end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Coach day', 'day', '2026-11-12', 'start', '07:00', 'end', '08:00')) then
    raise exception 'own workout missing %', feed;
  end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Morning lift' || dash || 'Jane', 'day', '2026-11-12', 'start', '09:00', 'end', '10:30')) then
    raise exception 'trainer-present client missing %', feed;
  end if;
  if feed::text like '%Easy day%' then raise exception 'solo client workout leaked'; end if;
  if feed::text like '%Fan lift%' then raise exception 'enthusiast shared while off'; end if;
  if feed::text like '%Ended lift%' or feed::text like '%Secret lift%' or feed::text like '%Free lift%' then
    raise exception 'unlinked workout leaked %', feed;
  end if;

  feed := public.calendar_feed_for_token('${CT}');
  select count(*) into n from jsonb_array_elements(feed->'events');
  if n <> 2 then raise exception 'client feed count %', feed; end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Morning lift')) then
    raise exception 'client own title changed %', feed;
  end if;
  if feed::text like '%Jane%' then raise exception 'client feed renamed their own workout'; end if;
  if feed::text like '%Coach day%' then raise exception 'client saw the trainer calendar'; end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Easy day', 'start', '15:00', 'end', '16:00')) then
    raise exception 'client solo missing %', feed;
  end if;

  feed := public.calendar_feed_for_token('${ET}');
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Fan lift')) then
    raise exception 'enthusiast own trainer-present missing %', feed;
  end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Fan solo', 'start', null, 'end', null)) then
    raise exception 'blank time was not kept %', feed;
  end if;
  if feed::text like '%Coach day%' or feed::text like '%Morning lift%' then
    raise exception 'enthusiast saw someone else %', feed;
  end if;
  if feed->>'timezone' is distinct from 'America/New_York' then raise exception 'enthusiast zone'; end if;

  feed := public.calendar_feed_for_token('${MT}');
  select count(*) into n from jsonb_array_elements(feed->'events');
  if n <> 1 then raise exception 'master feed count %', feed; end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Free lift' || dash || 'free2')) then
    raise exception 'email handle fallback %', feed;
  end if;

  if public.calendar_feed_for_token('${NT}') is not null then raise exception 'unknown token returned a feed'; end if;
  if public.calendar_feed_for_token('abc') is not null then raise exception 'short token returned a feed'; end if;
  if public.calendar_feed_for_token(null) is not null then raise exception 'null token returned a feed'; end if;
end $$;

update public.profiles set share_with_trainer = true where id = '${E}';

do $$
declare
  feed jsonb;
  dash text := ' ' || chr(8211) || ' ';
  n int;
begin
  feed := public.calendar_feed_for_token('${TT}');
  select count(*) into n from jsonb_array_elements(feed->'events');
  if n <> 3 then raise exception 'trainer event count after share %', feed; end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Fan lift' || dash || 'fan', 'day', '2026-11-13', 'start', '06:00', 'end', '07:00')) then
    raise exception 'shared enthusiast missing %', feed;
  end if;
  if feed::text like '%Fan solo%' then raise exception 'enthusiast solo leaked to trainer'; end if;
end $$;

set role service_role;
do $$
declare n int;
begin
  select count(*) into n from jsonb_array_elements(public.calendar_feed_for_token('${TT}')->'events');
  if n <> 3 then raise exception 'service role could not read the token feed %', n; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare n int;
begin
  begin
    perform public.calendar_feed_for_token('${TT}');
    raise exception 'authenticated called the feed lookup';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.calendar_feeds;
  if n <> 1 then raise exception 'client saw % feed rows', n; end if;
  select count(*) into n from public.calendar_feeds where user_id = '${T}';
  if n <> 0 then raise exception 'client read the trainer token'; end if;
  begin
    insert into public.calendar_feeds (user_id, token, time_zone)
    values ('${T}', repeat('1', 64), 'UTC');
    raise exception 'client created a trainer link';
  exception when others then
    if sqlerrm not like '%calendar link%' and sqlerrm not like '%row-level%' and sqlerrm not like '%violates%' then
      raise;
    end if;
  end;
  update public.calendar_feeds set token = repeat('2', 64) where user_id = '${C}';
  select count(*) into n from public.calendar_feeds where token = repeat('2', 64);
  if n <> 1 then raise exception 'client could not reset their own link'; end if;
  begin
    update public.calendar_feeds set token = 'short' where user_id = '${C}';
    raise exception 'short token was stored';
  exception when check_violation then
    null;
  end;
end $$;

set role anon;
do $$
begin
  begin
    perform public.calendar_feed_for_token('${TT}');
    raise exception 'anon called the feed lookup';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.calendar_feeds;
    raise exception 'anon read calendar links';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
do $$
declare n int;
begin
  if public.calendar_feed_for_token('${CT}') is not null then raise exception 'old client token still works'; end if;
  select count(*) into n from jsonb_array_elements(public.calendar_feed_for_token(repeat('2', 64))->'events');
  if n <> 2 then raise exception 'reset client token did not keep their calendar'; end if;
  select count(*) into n from public.calendar_feeds where user_id = '${T}' and token = '${TT}';
  if n <> 1 then raise exception 'trainer token was changed by the client'; end if;
end $$;
`;

psql('wb_calendar_test', assertSql);
psql('postgres', 'drop database if exists wb_calendar_test;\n');
console.log('calendar sql ok');
