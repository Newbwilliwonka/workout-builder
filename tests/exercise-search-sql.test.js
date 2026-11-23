// Exercise library search: punctuation, plurals, rank, and a typo fallback.
// Local Postgres only. Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261123050000_exercise_search_best_match.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');

[
  'create extension if not exists pg_trgm with schema extensions',
  'private.exercise_name_key',
  'name_key text',
  'generated always as (private.exercise_name_key(name)) stored',
  'exercises_name_key_idx',
  'exercises_name_key_trgm_idx',
  'gin_trgm_ops',
  'private.exercise_name_similarity',
  'private.is_approved((select auth.uid()))',
  'security invoker',
  'set search_path = public',
  'least(greatest(coalesce(p_limit, 20), 1), 30)',
  'greatest(coalesce(p_offset, 0), 0)',
  'e.body_part = s.body_part',
  'e.equipment = s.equipment',
  'e.target = s.target',
  'revoke all on function public.search_exercises(text, text, text, text, integer, integer) from public, anon',
  'grant execute on function public.search_exercises(text, text, text, text, integer, integer) to authenticated'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(!/insert into public\.exercises/i.test(sqlText));
assert.ok(!/update public\.exercises/i.test(sqlText));
assert.ok(!/delete from public\.exercises/i.test(sqlText));
assert.ok(/id text,\s*name text,\s*body_part text,\s*equipment text,\s*target text,\s*description text/.test(sqlText));

const auth = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
assert.ok(/rpc\('search_exercises'/.test(auth));
assert.ok(/p_query: query/.test(auth));
assert.ok(/p_limit: limit/.test(auth));
assert.ok(/p_offset: offset/.test(auth));
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert.ok(/search\(q, filters, 21, offset\)/.test(app));

const APPROVED = '11111111-1111-4111-8111-111111111111';
const WAITING = '22222222-2222-4222-8222-222222222222';

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

psql('postgres', 'drop database if exists wb_exercise_search_test;\ncreate database wb_exercise_search_test;\n');
psql('wb_exercise_search_test', `
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
files.forEach(function (name) {
  psql('wb_exercise_search_test', null, path.join(root, 'supabase/migrations', name));
});

const rows = [
  ['0662', 'push-up', 'chest', 'body weight', 'pectorals', 'Lower and press back up.'],
  ['1001', 'push-up (on stability ball)', 'chest', 'stability ball', 'pectorals', ''],
  ['1002', 'push-up (wall)', 'chest', 'body weight', 'pectorals', ''],
  ['c040', 'clap push-up', 'chest', 'body weight', 'pectorals', ''],
  ['c041', 'clap push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1010', 'knee push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1011', 'pike push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1008', 'hindu push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1003', 'archer push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1012', 'one-arm push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1006', 'decline push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1007', 'diamond push-up', 'chest', 'body weight', 'triceps', ''],
  ['1009', 'incline push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1013', 'wide-grip push-up', 'chest', 'body weight', 'pectorals', ''],
  ['1005', 'close-grip push-up', 'chest', 'body weight', 'triceps', ''],
  ['cgp0', 'close-grip press', 'chest', 'barbell', 'triceps', ''],
  ['cgp1', 'close-grip bench press', 'chest', 'barbell', 'triceps', ''],
  ['cgp2', 'close-grip incline bench press', 'chest', 'barbell', 'triceps', ''],
  ['pr00', 'press', 'chest', 'body weight', 'pectorals', ''],
  ['pr01', 'press down', 'upper arms', 'cable', 'triceps', ''],
  ['pr02', 'compression', 'chest', 'body weight', 'pectorals', ''],
  ['pr03', 'push press', 'shoulders', 'barbell', 'delts', ''],
  ['pr04', 'bench press', 'chest', 'barbell', 'pectorals', ''],
  ['pr05', 'overhead press', 'shoulders', 'barbell', 'delts', ''],
  ['pr06', 'incline bench press', 'chest', 'barbell', 'pectorals', ''],
  ['pr07', 'shoulder press', 'shoulders', 'dumbbell', 'delts', ''],
  ['pr08', 'presto curl', 'upper arms', 'dumbbell', 'biceps', ''],
  ['pr09', 'dumbbell bench press', 'chest', 'dumbbell', 'pectorals', ''],
  ['pu01', 'pull-up', 'back', 'body weight', 'lats', ''],
  ['sq01', 'squat', 'upper legs', 'body weight', 'quads', ''],
  ['0001', '3/4 sit-up', 'waist', 'body weight', 'abs', ''],
  ['su01', 'sit-up', 'waist', 'body weight', 'abs', ''],
  ['fw01', "farmer's walk", 'upper legs', 'dumbbell', 'quads', ''],
  ['cc01', 'circles, standing', 'shoulders', 'body weight', 'delts', '']
];
for (let n = 1; n <= 35; n++) {
  const num = String(n).padStart(2, '0');
  rows.push(['z' + num, 'zz-' + num, 'arms', 'body weight', 'forearms', '']);
}

function sqlQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

psql('wb_exercise_search_test', `
insert into auth.users (id, email) values
  ('${APPROVED}', 'ada@example.com'),
  ('${WAITING}', 'wait@example.com');
update public.profiles set access_approved = true, display_name = 'Ada' where id = '${APPROVED}';
update public.profiles set access_approved = false, display_name = 'Wait' where id = '${WAITING}';
insert into public.exercises (id, name, body_part, equipment, target, description) values
${rows.map(function (row) { return '(' + row.map(sqlQuote).join(', ') + ')'; }).join(',\n')};
`);

const before = psql('wb_exercise_search_test', `
select count(*)::text || ' ' || md5(string_agg(id || ':' || name || ':' || coalesce(name_key, ''), ',' order by id))
from public.exercises;
`);
psql('wb_exercise_search_test', null, path.join(root, migration));
const after = psql('wb_exercise_search_test', `
select count(*)::text || ' ' || md5(string_agg(id || ':' || name || ':' || coalesce(name_key, ''), ',' order by id))
from public.exercises;
`);
assert.strictEqual(after.trim(), before.trim(), 'running the migration again changed exercise rows');

const PUSH = [
  '0662', '1001', '1002', 'c040', 'c041', '1010', '1011', '1008', '1003', '1012',
  '1006', '1007', '1009', '1013', '1005'
].join(',');
const PRESS = [
  'pr00', 'pr01', 'pr02', 'pr03', 'pr04', 'pr05', 'pr07', 'cgp0', 'pr06', 'pr09', 'cgp1', 'cgp2'
].join(',');
const CLOSE = ['cgp0', 'cgp1', 'cgp2'].join(',');

const out = psql('wb_exercise_search_test', `
create or replace function public._wb_test_search_ids(q text, body text, equip text, target text, lim integer, off integer)
returns text
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  r record;
  out text := '';
begin
  for r in
    select id from public.search_exercises(q, body, equip, target, lim, off)
  loop
    out := out || case when out = '' then '' else ',' end || r.id;
  end loop;
  return out;
end;
$fn$;
revoke all on function public._wb_test_search_ids(text, text, text, text, integer, integer) from public, anon;
grant execute on function public._wb_test_search_ids(text, text, text, text, integer, integer) to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '${APPROVED}', false);

do $$
declare
  got text;
  again text;
  page text;
  n int;
  def text;
  args text;
  result text;
  vol "char";
  secdef boolean;
  generated "char";
  config text;
  sim_push real;
  sim_pull real;
begin
  select pg_get_function_identity_arguments(p.oid), p.provolatile, p.prosecdef,
         pg_get_function_result(p.oid), pg_get_functiondef(p.oid),
         coalesce(array_to_string(p.proconfig, ','), '')
    into args, vol, secdef, result, def, config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_exercises';
  if args is distinct from 'p_query text, p_body_part text, p_equipment text, p_target text, p_limit integer, p_offset integer' then
    raise exception 'signature %', args;
  end if;
  if result is distinct from 'TABLE(id text, name text, body_part text, equipment text, target text, description text)' then
    raise exception 'result %', result;
  end if;
  if vol <> 's' or secdef then
    raise exception 'volatility % security definer %', vol, secdef;
  end if;
  if position('private.is_approved' in def) = 0 then
    raise exception 'approval check missing';
  end if;
  if position('search_path=public' in config) = 0 then
    raise exception 'search_path %', config;
  end if;

  if not has_function_privilege('authenticated', 'public.search_exercises(text,text,text,text,integer,integer)', 'execute') then
    raise exception 'approved user cannot search';
  end if;
  if has_function_privilege('anon', 'public.search_exercises(text,text,text,text,integer,integer)', 'execute')
     or has_function_privilege('public', 'public.search_exercises(text,text,text,text,integer,integer)', 'execute') then
    raise exception 'anon or public can search';
  end if;

  select attgenerated into generated
  from pg_attribute
  where attrelid = 'public.exercises'::regclass and attname = 'name_key' and not attisdropped;
  if generated is distinct from 's' then
    raise exception 'name_key is not a stored generated column (%).', generated;
  end if;
  if (select name from public.exercises where id = '0662') is distinct from 'push-up' then
    raise exception 'display name changed';
  end if;
  if (select name_key from public.exercises where id = '0662') is distinct from 'pushup' then
    raise exception 'push-up key %', (select name_key from public.exercises where id = '0662');
  end if;
  if (select name_key from public.exercises where id = '0001') is distinct from '34situp' then
    raise exception 'sit-up key';
  end if;
  if (select name_key from public.exercises where id = 'fw01') is distinct from 'farmerswalk' then
    raise exception 'apostrophe key';
  end if;
  if (select name_key from public.exercises where id = 'cc01') is distinct from 'circlesstanding' then
    raise exception 'comma key';
  end if;
  if private.exercise_name_key('Push-Up') is distinct from 'pushup' then
    raise exception 'case fold';
  end if;

  select count(*) into n from pg_class where relname = 'exercises_name_key_trgm_idx';
  if n <> 1 then raise exception 'trgm index count %', n; end if;
  select count(*) into n from pg_class where relname = 'exercises_name_key_idx';
  if n <> 1 then raise exception 'name key index count %', n; end if;
  if not exists (
    select 1 from pg_extension e
    join pg_namespace ns on ns.oid = e.extnamespace
    where e.extname = 'pg_trgm' and ns.nspname = 'extensions'
  ) then
    raise exception 'pg_trgm is not in extensions';
  end if;

  foreach got in array array['push up', 'pushup', 'push-ups', 'push-up', 'PUSH UPS', 'push-up!'] loop
    again := public._wb_test_search_ids(got, '', '', '', 30, 0);
    if again is distinct from '${PUSH}' then
      raise exception 'query % got %', got, again;
    end if;
  end loop;

  again := public._wb_test_search_ids('push up', '', '', '', 30, 0);
  got := public._wb_test_search_ids('push up', '', '', '', 30, 0);
  if got is distinct from again then raise exception 'order changed between calls'; end if;

  page := public._wb_test_search_ids('push up', '', '', '', 5, 0)
    || ',' || public._wb_test_search_ids('push up', '', '', '', 5, 5)
    || ',' || public._wb_test_search_ids('push up', '', '', '', 5, 10);
  if page is distinct from '${PUSH}' then raise exception 'pages %', page; end if;
  if public._wb_test_search_ids('push up', '', '', '', 21, 0) is distinct from '${PUSH}' then
    raise exception 'limit 21';
  end if;
  if public._wb_test_search_ids('push up', '', '', '', 0, 0) is distinct from '0662' then
    raise exception 'limit 0 should return the first row';
  end if;
  if public._wb_test_search_ids('push up', '', '', '', 5, -4) is distinct from public._wb_test_search_ids('push up', '', '', '', 5, 0) then
    raise exception 'negative offset';
  end if;

  if public._wb_test_search_ids('press', '', '', '', 30, 0) is distinct from '${PRESS}' then
    raise exception 'press %', public._wb_test_search_ids('press', '', '', '', 30, 0);
  end if;
  if position('pr08' in public._wb_test_search_ids('press', '', '', '', 30, 0)) > 0 then
    raise exception 'press matched presto';
  end if;
  if position('0662' in public._wb_test_search_ids('press', '', '', '', 30, 0)) > 0 then
    raise exception 'press matched push-up';
  end if;

  if public._wb_test_search_ids('close grip press', '', '', '', 30, 0) is distinct from '${CLOSE}' then
    raise exception 'close grip %', public._wb_test_search_ids('close grip press', '', '', '', 30, 0);
  end if;
  if public._wb_test_search_ids('press close grip', '', '', '', 30, 0) is distinct from '${CLOSE}' then
    raise exception 'word order %', public._wb_test_search_ids('press close grip', '', '', '', 30, 0);
  end if;

  if public._wb_test_search_ids('3/4 sit-up', '', '', '', 30, 0) is distinct from '0001' then
    raise exception 'slash %', public._wb_test_search_ids('3/4 sit-up', '', '', '', 30, 0);
  end if;
  if public._wb_test_search_ids('34 sit up', '', '', '', 30, 0) is distinct from '0001' then
    raise exception 'compact sit %', public._wb_test_search_ids('34 sit up', '', '', '', 30, 0);
  end if;
  if public._wb_test_search_ids('sit up', '', '', '', 30, 0) is distinct from 'su01,0001' then
    raise exception 'sit up %', public._wb_test_search_ids('sit up', '', '', '', 30, 0);
  end if;
  if public._wb_test_search_ids('farmers walk', '', '', '', 30, 0) is distinct from 'fw01' then
    raise exception 'farmers %', public._wb_test_search_ids('farmers walk', '', '', '', 30, 0);
  end if;
  if public._wb_test_search_ids('farmer''s walk', '', '', '', 30, 0) is distinct from 'fw01' then
    raise exception 'apostrophe search';
  end if;
  if public._wb_test_search_ids('circles standing', '', '', '', 30, 0) is distinct from 'cc01' then
    raise exception 'comma search %', public._wb_test_search_ids('circles standing', '', '', '', 30, 0);
  end if;
  if position('0662' in public._wb_test_search_ids('ups', '', '', '', 30, 0)) > 0 then
    raise exception 'ups matched every up exercise';
  end if;

  select description, name, body_part, equipment, target
    into got, again, page, def, result
  from public.search_exercises('push-up', '', '', '', 1, 0);
  if got is distinct from 'Lower and press back up.' or again is distinct from 'push-up'
     or page is distinct from 'chest' or def is distinct from 'body weight'
     or result is distinct from 'pectorals' then
    raise exception 'row shape % % % % %', again, page, def, result, got;
  end if;

  if public._wb_test_search_ids('press', ' chest ', 'barbell', '', 30, 0) is distinct from 'pr04,cgp0,pr06,cgp1,cgp2' then
    raise exception 'barbell chest %', public._wb_test_search_ids('press', ' chest ', 'barbell', '', 30, 0);
  end if;
  -- cgp0 is close-grip press, equipment barbell, body chest. It contains press.
  -- Order for this filter is the press order restricted to those rows:
  -- pr04 bench (pos 6), cgp0 close-grip press (pos 10), pr06 incline (pos 13),
  -- cgp1 close-grip bench (pos 15), cgp2 later.
  if public._wb_test_search_ids('incline', '', 'barbell', '', 30, 0) is distinct from 'pr06,cgp2' then
    raise exception 'incline barbell %', public._wb_test_search_ids('incline', '', 'barbell', '', 30, 0);
  end if;
  if public._wb_test_search_ids('', '', 'barbell', '', 30, 0) is distinct from 'pr04,cgp1,cgp2,cgp0,pr06,pr05,pr03' then
    raise exception 'filter only %', public._wb_test_search_ids('', '', 'barbell', '', 30, 0);
  end if;
  if public._wb_test_search_ids('', '', '', 'triceps', 30, 0) is distinct from 'cgp1,cgp2,cgp0,1005,1007,pr01' then
    raise exception 'target only %', public._wb_test_search_ids('', '', '', 'triceps', 30, 0);
  end if;

  if public._wb_test_search_ids('', '', '', '', 30, 0) <> '' then raise exception 'empty query returned rows'; end if;
  if public._wb_test_search_ids('a', '', '', '', 30, 0) <> '' then raise exception 'one letter returned rows'; end if;
  if public._wb_test_search_ids('!!!', '', '', '', 30, 0) <> '' then raise exception 'punctuation query returned rows'; end if;
  if public._wb_test_search_ids('a!', '', '', '', 30, 0) <> ''
     or public._wb_test_search_ids('a-', '', '', '', 30, 0) <> ''
     or public._wb_test_search_ids('!!a', '', '', '', 30, 0) <> ''
     or public._wb_test_search_ids('3', '', '', '', 30, 0) <> '' then
    raise exception 'short compact key returned rows';
  end if;
  if public._wb_test_search_ids('a!', '', 'barbell', '', 30, 0)
       is distinct from public._wb_test_search_ids('', '', 'barbell', '', 30, 0)
     or public._wb_test_search_ids('!!!', '', 'barbell', '', 30, 0)
       is distinct from public._wb_test_search_ids('', '', 'barbell', '', 30, 0)
     or public._wb_test_search_ids('a', '', 'barbell', '', 30, 0)
       is distinct from public._wb_test_search_ids('', '', 'barbell', '', 30, 0) then
    raise exception 'short compact key with a filter did not match the empty query';
  end if;

  got := public._wb_test_search_ids('zz', '', '', '', 100, 0);
  select count(*) into n from regexp_split_to_table(got, ',');
  if n <> 30 then raise exception 'limit cap %', n; end if;
  if public._wb_test_search_ids('zz', '', '', '', 30, 30) is distinct from 'z31,z32,z33,z34,z35' then
    raise exception 'zz page %', public._wb_test_search_ids('zz', '', '', '', 30, 30);
  end if;
  if split_part(got, ',', 1) is distinct from 'z01' or split_part(got, ',', 30) is distinct from 'z30' then
    raise exception 'zz order %', got;
  end if;

  select private.exercise_name_similarity('pushp', 'pushup'),
         private.exercise_name_similarity('pushp', 'pullup')
    into sim_push, sim_pull;
  -- "pushp" is a real prefix of "push press", then a typo for "push-up".
  got := public._wb_test_search_ids('pushp', '', '', '', 30, 0);
  if got is distinct from 'pr03,0662' then
    raise exception 'typo pushp % sim push % pull %', got, sim_push, sim_pull;
  end if;
  got := public._wb_test_search_ids('push uo', '', '', '', 30, 0);
  if got is distinct from '0662' then
    raise exception 'typo push uo %', got;
  end if;
  got := public._wb_test_search_ids('cloes grip press', '', '', '', 30, 0);
  if got is distinct from 'cgp0' then
    raise exception 'typo close grip %', got;
  end if;
end $$;
`);

psql('wb_exercise_search_test', `
set role authenticated;
select set_config('request.jwt.claim.sub', '${WAITING}', false);
do $$
declare n int;
begin
  select count(*) into n from public.search_exercises('push up', '', '', '', 30, 0);
  if n <> 0 then raise exception 'unapproved search returned %', n; end if;
  select count(*) into n from public.exercises;
  if n <> 0 then raise exception 'unapproved read exercises'; end if;
end $$;
`);

psql('wb_exercise_search_test', `
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare n int;
begin
  select count(*) into n from public.search_exercises('push up', '', '', '', 30, 0);
  if n <> 0 then raise exception 'signed-out search returned %', n; end if;
end $$;
`);

psql('wb_exercise_search_test', `
set role anon;
do $$
begin
  perform * from public.search_exercises('push up', '', '', '', 20, 0);
  raise exception 'anon searched';
exception
  when insufficient_privilege then
    null;
end $$;
`);

psql('postgres', 'drop database if exists wb_exercise_search_test;\n');
console.log('EXERCISE SEARCH SQL OK');
