// Profile columns, RLS, and name labels. Local Postgres only. Does not touch the live project.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'supabase/migrations/20261115002700_profile_details.sql');
const sqlText = fs.readFileSync(file, 'utf8');
assert.ok(sqlText.indexOf("bucket_id = 'avatars'") > 0);
assert.ok(sqlText.indexOf('avatars_insert_own') > 0);
assert.ok(sqlText.indexOf('avatars_update_own') > 0);
assert.ok(sqlText.indexOf('avatars_select') > 0);
assert.ok(sqlText.indexOf('trainer_directory') > 0);
assert.ok(sqlText.indexOf('linked_profile_cards') > 0);

const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const S = '44444444-4444-4444-8444-444444444444';
const COPY = '55555555-5555-4555-8555-555555555555';

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

psql('postgres', 'drop database if exists wb_profile_test;\ncreate database wb_profile_test;\n');
psql('wb_profile_test', `
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
  'supabase/migrations/20261115002700_profile_details.sql'
].forEach(function (rel) { psql('wb_profile_test', null, path.join(root, rel)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'free_client', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'enthusiast', email = 'stranger@example.com' where id = '${S}';
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');
update public.profiles set display_name = 'Coach Kim', city = 'Austin', state = 'TX', avatar_path = '${T}/avatar.jpg' where id = '${T}';
update public.profiles set display_name = 'Ada' where id = '${C}';
insert into public.workout_copies (id, owner_id, trainer_id, name, items)
  values ('${COPY}', '${C}', '${T}', 'Friday', '[]'::jsonb);

do $$
declare
  cols text;
  threads jsonb;
  roster jsonb;
  mine jsonb;
  status jsonb;
  link jsonb;
begin
  select string_agg(column_name, ',' order by column_name) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'linked_profile_cards';
  if cols <> 'avatar_path,display_name,id' then raise exception 'linked columns %', cols; end if;
  select string_agg(column_name, ',' order by column_name) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'trainer_directory';
  if cols <> 'bio,city,display_name,id,online_only,state' then raise exception 'directory columns %', cols; end if;
  if has_table_privilege('authenticated', 'public.trainer_directory', 'select') then
    raise exception 'trainer search is granted too early';
  end if;
  if not has_table_privilege('authenticated', 'public.linked_profile_cards', 'select') then
    raise exception 'linked cards are not readable';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);

do $$
declare n int; seen text; threads jsonb; mine jsonb; link jsonb;
begin
  select count(*) into n from public.profiles where id = '${T}';
  if n <> 0 then raise exception 'client read the trainer row'; end if;
  select display_name into seen from public.linked_profile_cards where id = '${T}';
  if seen <> 'Coach Kim' then raise exception 'linked name %', seen; end if;
  select avatar_path into seen from public.linked_profile_cards where id = '${T}';
  if seen <> '${T}/avatar.jpg' then raise exception 'linked photo %', seen; end if;
  select count(*) into n from public.linked_profile_cards where id = '${S}';
  if n <> 0 then raise exception 'stranger card leaked'; end if;
  update public.profiles set display_name = 'Hacked' where id = '${T}';
  if found then raise exception 'client edited the trainer'; end if;
  threads := public.message_threads();
  select elem->>'name' into seen from jsonb_array_elements(threads->'threads') elem where elem->>'id' = '${T}';
  if seen <> 'Coach Kim' then raise exception 'message title %', seen; end if;
  mine := public.workout_mine();
  if mine->0->>'sourceTrainerName' <> 'Coach Kim' then raise exception 'from name %', mine; end if;
  if mine->0->>'sourceTrainerEmail' <> 'coach@example.com' then raise exception 'from email %', mine; end if;
  link := public.invite_mine();
  if link->>'trainerName' <> 'Coach Kim' then raise exception 'trainer link %', link; end if;
  if link->>'trainerEmail' <> 'coach@example.com' then raise exception 'trainer email %', link; end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare roster jsonb; seen text; status jsonb;
begin
  roster := public.invite_roster();
  select elem->>'name' into seen from jsonb_array_elements(roster->'clients') elem where elem->>'id' = '${C}';
  if seen <> 'Ada' then raise exception 'client list %', seen; end if;
  select elem->>'email' into seen from jsonb_array_elements(roster->'clients') elem where elem->>'id' = '${C}';
  if seen <> 'ada@example.com' then raise exception 'client email dropped %', seen; end if;
  status := public.share_status('${C}');
  if status->>'name' <> 'Ada' then raise exception 'status name %', status; end if;
  begin
    update public.profiles set display_name = 'No place', city = null, state = null, online_only = false where id = '${T}';
    raise exception 'trainer saved a name without a location';
  exception when others then
    if sqlerrm not like '%Online only%' then raise; end if;
  end;
  update public.profiles set display_name = 'Coach Kim', online_only = true, city = null, state = null where id = '${T}';
  begin
    update public.profiles set display_name = null where id = '${T}';
    raise exception 'name was cleared';
  exception when others then
    if sqlerrm not like '%Enter your name%' then raise; end if;
  end;
  begin
    update public.profiles set bio = repeat('a', 151) where id = '${T}';
    raise exception 'long bio saved';
  exception when others then
    if sqlerrm not like '%150%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
begin
  update public.profiles set display_name = 'Nickname' where id = '${S}';
  if not found then raise exception 'enthusiast could not save a nickname'; end if;
end $$;

reset role;
select display_name from public.profiles where id = '${S}';
`;

const out = psql('wb_profile_test', assertSql);
if (out.indexOf('Nickname') === -1) {
  console.error(out);
  process.exit(1);
}
console.log('profile sql ok');
