// Other people's emails stay out of roster, messages, shares, copies, and calendar titles.
// Local Postgres only. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';
const F = '55555555-5555-4555-8555-555555555555';
const N = '66666666-6666-4666-8666-666666666666';
const A = '77777777-7777-4777-8777-777777777777';
const M = '88888888-8888-4888-8888-888888888888';
const COPY = '99999999-9999-4999-8999-999999999999';
const COPY2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MSG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TT = 'a'.repeat(64);

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

psql('postgres', 'drop database if exists wb_privacy_test;\ncreate database wb_privacy_test;\n');
psql('wb_privacy_test', `
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

[
  'supabase/migrations/20261106150000_profiles.sql',
  'supabase/migrations/20261107160000_invites.sql',
  'supabase/migrations/20261109195000_exercises.sql',
  'supabase/migrations/20261110220000_exercise_search_description.sql',
  'supabase/migrations/20261111120000_messages.sql',
  'supabase/migrations/20261111140000_workout_copies.sql',
  'supabase/migrations/20261111160000_share_own.sql',
  'supabase/migrations/20261111180000_programs.sql',
  'supabase/migrations/20261111223000_program_times.sql',
  'supabase/migrations/20261112120000_trainer_own_program.sql',
  'supabase/migrations/20261112150000_calendar_feeds.sql',
  'supabase/migrations/20261112200000_account_workouts.sql',
  'supabase/migrations/20261115002700_profile_details.sql',
  'supabase/migrations/20261115140000_master_trainer_verification.sql',
  'supabase/migrations/20261115180000_workout_tracking.sql',
  'supabase/migrations/20261116150000_shared_dashboards.sql',
  'supabase/migrations/20261116180000_share_inbox_any_client.sql'
].forEach(function (file) { psql('wb_privacy_test', null, path.join(root, file)); });

psql('wb_privacy_test', `
insert into auth.users (id, email) values
  ('${T}', 'zzcoach@example.com'),
  ('${C}', 'zzada@example.com'),
  ('${E}', 'zzfan@example.com'),
  ('${P}', 'zzpat@example.com'),
  ('${F}', 'zzfree@example.com'),
  ('${N}', 'zzplain@example.com'),
  ('${A}', 'kinisiathletics@gmail.com'),
  ('${M}', 'zzmaster@example.com');
update public.profiles set membership = 'trainer', email = 'zzcoach@example.com', display_name = 'Coach Kim', city = 'Austin', state = 'TX' where id = '${T}';
update public.profiles set membership = 'free_client', email = 'zzada@example.com', display_name = 'Ada' where id = '${C}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'zzfan@example.com', display_name = 'zzfan@example.com', share_with_trainer = true where id = '${E}';
update public.profiles set membership = 'free_client', email = 'zzpat@example.com' where id = '${P}';
update public.profiles set membership = 'free_client', email = 'zzfree@example.com' where id = '${F}';
update public.profiles set membership = 'trainer', email = 'zzplain@example.com', city = 'Austin', state = 'TX' where id = '${N}';
update public.profiles set membership = 'trainer', email = 'kinisiathletics@gmail.com', display_name = 'Admin' where id = '${A}';
update public.profiles set membership = 'master_trainer', email = 'zzmaster@example.com', display_name = 'Master Mo' where id = '${M}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}'),
  ('${T}', '${F}'),
  ('${N}', '${P}');
insert into public.workout_copies (id, owner_id, trainer_id, name, items) values
  ('${COPY}', '${C}', '${T}', 'Friday', '[]'::jsonb),
  ('${COPY2}', '${P}', '${N}', 'Plain day', '[]'::jsonb);
insert into public.messages (id, trainer_id, client_id, sender_id, body) values
  ('${MSG}', '${T}', '${C}', '${C}', 'Hello from Ada');
insert into public.program_entries (owner_id, local_id, workout_local_id, workout_name, items, day, presence, starts_at, ends_at) values
  ('${T}', 'own1', 'wo-own', 'Coach day', '[]'::jsonb, '2026-11-16', 'solo', '07:00', '08:00'),
  ('${C}', 'ada1', 'wo-ada', 'Morning lift', '[]'::jsonb, '2026-11-16', 'trainer', '09:00', '10:00'),
  ('${F}', 'free1', 'wo-free', 'Free lift', '[]'::jsonb, '2026-11-16', 'trainer', '11:00', '12:00'),
  ('${E}', 'fan1', 'wo-fan', 'Fan lift', '[]'::jsonb, '2026-11-16', 'trainer', '06:00', '07:00'),
  ('${E}', 'fan-solo', 'wo-solo', 'Fan solo', '[]'::jsonb, '2026-11-16', 'solo', null, null);
insert into public.calendar_feeds (user_id, token, time_zone) values
  ('${T}', '${TT}', 'America/New_York');
insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards) values
  ('${C}', '${T}', 'zzcoach@example.com', '2026-11-16', '[{"type":"plan"}]'::jsonb),
  ('${P}', '${N}', 'zzplain@example.com', '2026-11-16', '[{"type":"plan"}]'::jsonb);
`);

psql('wb_privacy_test', null, path.join(root, 'supabase/migrations/20261116210000_hide_other_emails.sql'));

const assertSql = `
do $$
declare
  roster jsonb;
  link jsonb;
  threads jsonb;
  opened jsonb;
  status jsonb;
  mine jsonb;
  feed jsonb;
  seen text;
  result text;
  n int;
  policies int;
  dash text := ' ' || chr(8211) || ' ';
begin
  if pg_get_function_result('public.message_roster()'::regprocedure) like '%email%' then
    raise exception 'message roster still has an email column %', pg_get_function_result('public.message_roster()'::regprocedure);
  end if;
  if pg_get_function_result('public.message_roster()'::regprocedure) not like '%name text%' then
    raise exception 'message roster name column %', pg_get_function_result('public.message_roster()'::regprocedure);
  end if;
  if not has_function_privilege('authenticated', 'public.message_roster()', 'execute') then
    raise exception 'roster execute was dropped';
  end if;
  if has_function_privilege('anon', 'public.message_roster()', 'execute') then
    raise exception 'anon can call the roster';
  end if;
  if not has_function_privilege('authenticated', 'public.message_pair(uuid)', 'execute') then
    raise exception 'message pair execute was dropped';
  end if;
  if has_function_privilege('authenticated', 'public.calendar_feed_for_token(text)', 'execute') then
    raise exception 'signed-in users can call the calendar feed';
  end if;
  if not has_function_privilege('service_role', 'public.calendar_feed_for_token(text)', 'execute') then
    raise exception 'service role lost the calendar feed';
  end if;
  select count(*) into policies
  from pg_policy
  where polrelid = 'public.profiles'::regclass
    and polcmd in ('r', '*');
  if policies <> 1 then raise exception 'profile select policies %', policies; end if;

  select count(*) into n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'email' and not a.attisdropped
  where ns.nspname = 'public'
    and c.relkind in ('v', 'm')
    and has_table_privilege('authenticated', c.oid, 'select')
    and c.relname <> 'verification_queue';
  if n <> 0 then raise exception 'a view still exposes email'; end if;

  if (select trainer_name from public.shared_dashboards where client_id = '${C}') <> 'Coach Kim' then
    raise exception 'saved coach email was kept';
  end if;
  if (select trainer_name from public.shared_dashboards where client_id = '${P}') <> 'Trainer' then
    raise exception 'saved plain email was kept';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);

do $$
declare roster jsonb; seen text; status jsonb; threads jsonb; opened jsonb;
begin
  if (select email from public.profiles where id = '${T}') <> 'zzcoach@example.com' then
    raise exception 'trainer lost their own email';
  end if;
  if (select count(*) from public.profiles where id = '${C}') <> 0 then
    raise exception 'trainer read the client profile row';
  end if;

  roster := public.invite_roster();
  if roster::text like '%@%' or roster::text like '%zz%' then
    raise exception 'roster leaked an email %', roster;
  end if;
  select elem->>'name' into seen from jsonb_array_elements(roster->'clients') elem where elem->>'id' = '${C}';
  if seen <> 'Ada' then raise exception 'ada name %', seen; end if;
  select elem->>'email' into seen from jsonb_array_elements(roster->'clients') elem where elem->>'id' = '${C}';
  if seen is not null then raise exception 'client email still returned %', seen; end if;
  if not exists (
    select 1 from jsonb_array_elements(roster->'clients') elem
    where elem->>'id' = '${C}' and elem ? 'membership' and elem->>'plan' = 'Free Client' and elem ? 'avatarPath'
  ) then
    raise exception 'roster dropped client fields %', roster;
  end if;
  select elem->>'name' into seen from jsonb_array_elements(roster->'clients') elem where elem->>'id' = '${E}';
  if seen <> 'Enthusiast' then raise exception 'email display name leaked as %', seen; end if;
  select elem->>'name' into seen from jsonb_array_elements(roster->'clients') elem where elem->>'id' = '${F}';
  if seen <> 'Client' then raise exception 'unnamed client %', seen; end if;

  status := public.share_status('${C}');
  if status ? 'email' or status::text like '%@%' then raise exception 'status email %', status; end if;
  if status->>'name' <> 'Ada' or status->>'plan' <> 'Free Client' then raise exception 'status %', status; end if;
  status := public.share_status('${E}');
  if status->>'name' <> 'Enthusiast' or status->>'plan' <> 'Enthusiast' then raise exception 'fan status %', status; end if;
  status := public.share_status('${F}');
  if status->>'name' <> 'Client' then raise exception 'free status %', status; end if;

  threads := public.message_threads();
  if threads::text like '%@%' or threads::text like '%zz%' then raise exception 'threads leaked %', threads; end if;
  select elem->>'name' into seen from jsonb_array_elements(threads->'threads') elem where elem->>'id' = '${C}';
  if seen <> 'Ada' then raise exception 'thread name %', seen; end if;
  select elem->>'name' into seen from jsonb_array_elements(threads->'threads') elem where elem->>'id' = '${E}';
  if seen <> 'Enthusiast' then raise exception 'fan thread %', seen; end if;
  select elem->>'name' into seen from jsonb_array_elements(threads->'threads') elem where elem->>'id' = '${F}';
  if seen <> 'Client' then raise exception 'free thread %', seen; end if;
  opened := public.message_open('${C}');
  if opened->'person'->>'name' <> 'Ada' or opened::text like '%@%' then raise exception 'open %', opened; end if;
  if position('Hello from Ada' in opened::text) = 0 then raise exception 'message body missing %', opened; end if;

  insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
  values ('${F}', '${T}', 'zzcoach@example.com', '2026-11-16', '[{"type":"plan"}]'::jsonb);
  if (select trainer_name from public.shared_dashboards where client_id = '${F}') <> 'Coach Kim' then
    raise exception 'insert kept an email name';
  end if;
  insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
  values ('${E}', '${T}', 'Coach Lee', '2026-11-16', '[{"type":"pass"}]'::jsonb);
  if (select trainer_name from public.shared_dashboards where client_id = '${E}') <> 'Coach Lee' then
    raise exception 'real trainer name was replaced';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare link jsonb; mine jsonb; threads jsonb; seen text;
begin
  if (select count(*) from public.profiles where id = '${T}') <> 0 then
    raise exception 'client read the trainer profile row';
  end if;
  if (select email from public.profiles where id = '${C}') <> 'zzada@example.com' then
    raise exception 'client lost their own email';
  end if;
  link := public.invite_mine();
  if link ? 'trainerEmail' or link::text like '%@%' or link::text like '%zz%' then
    raise exception 'trainer link leaked %', link;
  end if;
  if link->>'trainerName' <> 'Coach Kim' or link->>'trainerId' <> '${T}' then
    raise exception 'trainer link %', link;
  end if;
  if not (link ? 'avatarPath') or not (link ? 'verified') then
    raise exception 'trainer link dropped fields %', link;
  end if;
  mine := public.workout_mine();
  if mine::text like '%sourceTrainerEmail%' or mine::text like '%@%' or mine::text like '%zz%' then
    raise exception 'copies leaked %', mine;
  end if;
  if mine->0->>'sourceTrainerName' <> 'Coach Kim' then raise exception 'copy name %', mine; end if;
  threads := public.message_threads();
  select elem->>'name' into seen from jsonb_array_elements(threads->'threads') elem where elem->>'id' = '${T}';
  if seen <> 'Coach Kim' then raise exception 'client thread title %', seen; end if;
end $$;

select set_config('request.jwt.claim.sub', '${P}', false);
do $$
declare link jsonb; mine jsonb;
begin
  link := public.invite_mine();
  if link->>'trainerName' <> 'Trainer' or link::text like '%@%' then
    raise exception 'unnamed trainer %', link;
  end if;
  mine := public.workout_mine();
  if mine->0->>'sourceTrainerName' <> 'your trainer' or mine::text like '%@%' then
    raise exception 'unnamed copy %', mine;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
values ('${P}', '${N}', 'leak@example.com', '2026-11-17', '[{"type":"workouts"}]'::jsonb);
do $$
begin
  if (select trainer_name from public.shared_dashboards where client_id = '${P}' and as_of = '2026-11-17') <> 'Trainer' then
    raise exception 'owner insert kept an email';
  end if;
end $$;

-- The guard replaces an email before the check. Disable it once to prove the check rejects a raw email.
alter table public.shared_dashboards disable trigger shared_dashboards_guard;
do $$
begin
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards)
    values ('${C}', '${N}', 'still@example.com', '2026-11-18', '[{"type":"plan"}]'::jsonb);
    raise exception 'constraint allowed an email name';
  exception when check_violation then
    null;
  end;
end $$;
alter table public.shared_dashboards enable trigger shared_dashboards_guard;

do $$
declare feed jsonb; dash text := ' ' || chr(8211) || ' ';
begin
  feed := public.calendar_feed_for_token('${TT}');
  if feed::text like '%@%' or feed::text like '%zz%' then
    raise exception 'calendar leaked an email %', feed;
  end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Coach day')) then
    raise exception 'own title changed %', feed;
  end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Morning lift' || dash || 'Ada')) then
    raise exception 'named client title %', feed;
  end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Free lift' || dash || 'Client')) then
    raise exception 'unnamed client title %', feed;
  end if;
  if not feed->'events' @> jsonb_build_array(jsonb_build_object('title', 'Fan lift' || dash || 'Enthusiast')) then
    raise exception 'enthusiast title %', feed;
  end if;
  if feed::text like '%Fan solo%' then raise exception 'solo workout leaked %', feed; end if;
end $$;

set role service_role;
do $$
declare n int;
begin
  select count(*) into n from jsonb_array_elements(public.calendar_feed_for_token('${TT}')->'events');
  if n <> 4 then raise exception 'service role feed count %', n; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  begin
    perform public.calendar_feed_for_token('${TT}');
    raise exception 'authenticated called the feed lookup';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.verification_requests (user_id, cert_body, cert_number, expires_on)
values ('${M}', 'NASM', 'PRIV-1', current_date + 40);

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.verification_queue;
  if n <> 0 then raise exception 'trainer read the verification queue'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${A}', false);
do $$
declare seen text;
begin
  select email into seen from public.verification_queue where user_id = '${M}';
  if seen <> 'zzmaster@example.com' then raise exception 'admin queue email %', seen; end if;
end $$;
`;

psql('wb_privacy_test', assertSql);
psql('postgres', 'drop database if exists wb_privacy_test;\n');
console.log('privacy sql ok');
