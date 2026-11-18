// Near me pins, privacy, and rounded distance. Local Postgres only.
// Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261118230000_trainer_near.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
[
  'private.trainer_locations',
  'private.distance_miles',
  'private.rounded_miles',
  'public.my_service_locations',
  'public.save_service_location',
  'public.remove_service_location',
  'distanceMiles',
  'comingSoon',
  'in_person',
  'slot',
  'revoke all on table private.trainer_locations from public, anon, authenticated'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(/not inserted/i.test(sqlText));

const AMY = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const CARA = '33333333-3333-4333-8333-333333333333';
const DEE = '44444444-4444-4444-8444-444444444444';
const NIA = '55555555-5555-4555-8555-555555555555';
const QUINN = '66666666-6666-4666-8666-666666666666';
const SAM = '77777777-7777-4777-8777-777777777777';
const C1 = '12121212-1212-4121-8121-121212121212';
const C2 = '13131313-1313-4131-8131-131313131313';

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

psql('postgres', 'drop database if exists wb_near_test;\ncreate database wb_near_test;\n');
psql('wb_near_test', `
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
  psql('wb_near_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_near_test', null, path.join(root, migration));

const people = [
  [AMY, 'amy@example.com', 'Amy Coach', 'master_trainer', true, 'both', true],
  [BEA, 'bea@example.com', 'Bea Coach', 'trainer', true, 'online', false],
  [CARA, 'cara@example.com', 'Cara Coach', 'trainer', true, 'in_person', false],
  [DEE, 'dee@example.com', 'Dee Coach', 'trainer', false, 'in_person', false],
  [NIA, 'nia@example.com', 'Nia Coach', 'trainer', true, 'in_person', false],
  [QUINN, 'quinn@example.com', 'Quinn Coach', 'trainer', true, 'in_person', false],
  [SAM, 'sam-t@example.com', 'Sam Coach', 'trainer', true, 'online', false],
  [C1, 'ada@example.com', 'Ada Lee', 'free_client', false, null, false],
  [C2, 'linked@example.com', 'Linked Client', 'free_client', false, null, false]
];

psql('wb_near_test', `
insert into auth.users (id, email) values
${people.map(function (row) { return `('${row[0]}', '${row[1]}')`; }).join(',\n')};
${people.map(function (row) {
  const service = row[5] ? `'${row[5]}'` : 'null';
  const until = row[6] ? 'current_date + 30' : 'null';
  const approved = row[0] === QUINN ? 'false' : 'true';
  return `update public.profiles set access_approved = ${approved}, membership = '${row[3]}', display_name = '${row[2]}', online_only = true, listed = ${row[4]}, service_type = ${service}, verified_until = ${until} where id = '${row[0]}';`;
}).join('\n')}
insert into public.trainer_clients (trainer_id, client_id) values ('${AMY}', '${C2}');

insert into private.trainer_locations (trainer_id, slot, latitude, longitude, city, region, country) values
  ('${AMY}', 1, 30.26715, -97.74310, 'Austin', 'Texas', 'United States'),
  ('${BEA}', 1, 32.77670, -96.79700, 'Dallas', 'Texas', 'United States'),
  ('${CARA}', 1, 30.50830, -97.67890, 'Round Rock', 'Texas', 'United States'),
  ('${DEE}', 1, 30.26715, -97.74310, 'Hidden', 'Texas', 'United States');

do $$
declare i int;
  pid uuid;
begin
  for i in 1..11 loop
    pid := ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id, email) values (pid, 'near' || i || '@example.com');
    update public.profiles
      set access_approved = true,
          membership = 'trainer',
          display_name = 'Near ' || lpad(i::text, 2, '0'),
          online_only = true,
          listed = true,
          service_type = 'in_person'
      where id = pid;
    insert into private.trainer_locations (trainer_id, slot, latitude, longitude, city, region, country)
    values (pid, 1, 30.26715 + (i * 0.25), -97.74310, 'City ' || i, 'Texas', 'United States');
  end loop;
end $$;
`);

const out = psql('wb_near_test', `
do $$
declare n int;
begin
  if has_table_privilege('anon', 'private.trainer_locations', 'select')
     or has_table_privilege('authenticated', 'private.trainer_locations', 'select')
     or has_table_privilege('authenticated', 'private.trainer_locations', 'insert')
     or has_column_privilege('authenticated', 'private.trainer_locations', 'latitude', 'select')
     or has_column_privilege('anon', 'private.trainer_locations', 'longitude', 'select') then
    raise exception 'pin table is readable';
  end if;
  if has_function_privilege('anon', 'public.my_service_locations()', 'execute')
     or has_function_privilege('anon', 'public.save_service_location(double precision, double precision, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.trainer_search(text, double precision, double precision)', 'execute')
     or has_function_privilege('authenticated', 'private.distance_miles(double precision, double precision, double precision, double precision)', 'execute')
     or has_function_privilege('authenticated', 'private.rounded_miles(double precision, double precision, double precision, double precision)', 'execute') then
    raise exception 'distance or pins are executable by the wrong role';
  end if;
  select count(*) into n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relkind in ('v', 'm')
    and pg_get_viewdef(c.oid) ilike '%trainer_locations%';
  if n <> 0 then raise exception 'a public view exposes pins'; end if;
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and column_name in ('latitude', 'longitude');
  if n <> 0 then raise exception 'public latitude column %', n; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);

do $$
declare result jsonb; near jsonb; names text; item jsonb; prev int; miles int;
begin
  begin
    perform public.save_service_location(30, -97, 'Austin', 'Texas', 'United States');
    raise exception 'client saved a pin';
  exception when others then
    if sqlerrm not like '%Only a Trainer or Master Trainer%' then
      raise exception 'client pin said %', sqlerrm;
    end if;
  end;
  if public.my_service_locations() <> '[]'::jsonb then
    raise exception 'client read a pin %', public.my_service_locations();
  end if;
  begin
    perform 1 from private.trainer_locations;
    raise exception 'authenticated selected pins';
  exception when insufficient_privilege then
    null;
  end;

  result := public.trainer_search('online', null, null);
  if result->>'comingSoon' <> 'false' or result->>'mode' <> 'online' then
    raise exception 'online shape %', result;
  end if;
  if position('@' in result::text) > 0 then raise exception 'online leaked email %', result; end if;
  if result::text like '%30.26715%' or result::text like '%-97.74310%' or result::text like '%latitude%' then
    raise exception 'online leaked a coordinate %', result;
  end if;
  if result->'trainers'->0->>'name' <> 'Amy Coach' then
    raise exception 'online rank %', result->'trainers';
  end if;
  if result->'trainers'->0->>'city' <> 'Austin' or result->'trainers'->0->>'state' <> 'Texas' then
    raise exception 'amy place %', result->'trainers'->0;
  end if;
  if result->'trainers'->0->>'verified' <> 'true' or result->'trainers'->0->>'role' <> 'Master Trainer' then
    raise exception 'amy badges %', result->'trainers'->0;
  end if;
  select elem into item
  from jsonb_array_elements(result->'trainers') as elem
  where elem->>'name' = 'Bea Coach';
  if item->>'city' <> 'Dallas' or item->>'state' <> 'Texas' or item->>'serviceType' <> 'online' then
    raise exception 'bea place %', item;
  end if;
  select elem into item
  from jsonb_array_elements(result->'trainers') as elem
  where elem->>'name' = 'Sam Coach';
  if item->>'city' is not null or item->>'state' is not null then
    raise exception 'sam should have no public place %', item;
  end if;
  if result::text like '%Cara Coach%' or result::text like '%Near %' then
    raise exception 'online included an in-person trainer %', result;
  end if;

  near := public.trainer_search('near', 30.26715, -97.74310);
  if near->>'comingSoon' <> 'false' or near->>'mode' <> 'near' then
    raise exception 'near shape %', near;
  end if;
  if jsonb_array_length(near->'trainers') <> 10 then
    raise exception 'near count %', near->'trainers';
  end if;
  if position('@' in near::text) > 0 or near::text like '%30.26715%' or near::text like '%latitude%' or near::text like '%longitude%' then
    raise exception 'near leaked a private field %', near;
  end if;
  select string_agg(elem->>'name', '|' order by ord) into names
  from jsonb_array_elements(near->'trainers') with ordinality as t(elem, ord);
  if split_part(names, '|', 1) <> 'Amy Coach' then raise exception 'closest %', names; end if;
  if names like '%Bea Coach%' or names like '%Dee Coach%' or names like '%Nia Coach%' or names like '%Quinn Coach%' or names like '%Sam Coach%' then
    raise exception 'near included someone hidden %', names;
  end if;
  if names like '%Near 10%' or names like '%Near 11%' then
    raise exception 'near returned past the top 10 %', names;
  end if;
  prev := 0;
  for item in select t.value from jsonb_array_elements(near->'trainers') as t(value) loop
    if item ? 'latitude' or item ? 'longitude' or item ? 'country' or item ? 'email' then
      raise exception 'near row has a private key %', item;
    end if;
    if item->>'distanceMiles' !~ '^[0-9]+$' then
      raise exception 'distance not a whole mile %', item->>'distanceMiles';
    end if;
    miles := (item->>'distanceMiles')::int;
    if miles < prev then raise exception 'not closest first %', names; end if;
    if miles < 1 then raise exception 'zero mile distance %', item; end if;
    prev := miles;
  end loop;
  if (near->'trainers'->0->>'distanceMiles')::int <> 1 then
    raise exception 'same-point distance %', near->'trainers'->0->>'distanceMiles';
  end if;
  if near->'trainers'->0->>'serviceType' <> 'both' then
    raise exception 'amy service %', near->'trainers'->0;
  end if;
  select elem into item
  from jsonb_array_elements(near->'trainers') as elem
  where elem->>'name' = 'Cara Coach';
  if item is null or item->>'city' <> 'Round Rock' or item->>'state' <> 'Texas' or item->>'serviceType' <> 'in_person' then
    raise exception 'cara near %', item;
  end if;
  if (item->>'distanceMiles')::int <= 1 then
    raise exception 'cara should be farther than amy %', item->>'distanceMiles';
  end if;

  perform public.trainer_request_send('${CARA}'::uuid, '  Hello <b>there</b>  ');
end $$;

select set_config('request.jwt.claim.sub', '${C2}', false);
do $$
declare near jsonb;
begin
  near := public.trainer_search('near', 29.424199, -98.493629);
  if near::text like '%Amy Coach%' then raise exception 'linked trainer was nearby'; end if;
  if near::text like '%29.424199%' or near::text like '%-98.493629%' then
    raise exception 'client point came back %', near;
  end if;
end $$;

reset role;
do $$
declare n int;
begin
  select count(*) into n from private.trainer_locations
  where abs(latitude - 29.424199) < 0.000001
     or abs(longitude - (-98.493629)) < 0.000001;
  if n <> 0 then raise exception 'client location was stored'; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${BEA}', false);
do $$
declare mine jsonb; again jsonb;
begin
  mine := public.save_service_location(32.10000, -96.10000, '  Dallas  ', 'Texas', 'United States');
  if mine->>'city' <> 'Dallas' or (mine->>'latitude')::float8 <> 32.1 then
    raise exception 'save %', mine;
  end if;
  again := public.save_service_location(32.75550, -97.33080, 'Fort Worth', 'Texas', 'United States');
  if again->>'city' <> 'Fort Worth' or (again->>'slot')::int <> 1 then
    raise exception 'second pin %', again;
  end if;
  mine := public.my_service_locations();
  if jsonb_array_length(mine) <> 1 or mine->0->>'city' <> 'Fort Worth' then
    raise exception 'own pins %', mine;
  end if;
  if mine::text like '%30.26715%' or mine::text like '%Round Rock%' then
    raise exception 'own list included someone else %', mine;
  end if;
  if public.remove_service_location()->>'removed' <> 'true' then
    raise exception 'remove failed';
  end if;
  if public.my_service_locations() <> '[]'::jsonb then
    raise exception 'pin remained %', public.my_service_locations();
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${AMY}', false);
do $$
declare mine jsonb;
begin
  mine := public.my_service_locations();
  if jsonb_array_length(mine) <> 1 or mine->0->>'city' <> 'Austin' then
    raise exception 'amy pin %', mine;
  end if;
  if mine::text like '%Fort Worth%' or mine::text like '%32.75550%' then
    raise exception 'amy saw another pin %', mine;
  end if;
  begin
    perform public.trainer_search('near', null, null);
    raise exception 'trainer searched near';
  exception when others then
    if sqlerrm not like '%clients and enthusiasts%' then raise exception 'trainer near said %', sqlerrm; end if;
  end;
  update public.profiles
    set city = null, state = null, online_only = false, listed = true, service_type = 'online'
    where id = '${AMY}';
  if not (select online_only from public.profiles where id = '${AMY}') then
    raise exception 'online service did not set online only';
  end if;
  if (select city from public.profiles where id = '${AMY}') is not null
     or (select state from public.profiles where id = '${AMY}') is not null then
    raise exception 'a typed city was still required';
  end if;
  update public.profiles
    set service_type = 'both', online_only = true, city = null, state = null
    where id = '${AMY}';
  if (select online_only from public.profiles where id = '${AMY}') then
    raise exception 'in person and online stayed online only';
  end if;
  if (select service_type from public.profiles where id = '${AMY}') <> 'both' then
    raise exception 'both was not kept';
  end if;
  update public.profiles
    set service_type = 'in_person', online_only = true
    where id = '${AMY}';
  if (select online_only from public.profiles where id = '${AMY}') then
    raise exception 'in person kept online only';
  end if;
  update public.profiles set service_type = 'both', listed = true where id = '${AMY}';
end $$;

select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
begin
  begin
    perform public.trainer_search('near', null, null);
    raise exception 'near without a point';
  exception when others then
    if sqlerrm not like '%Choose a location.%' then raise exception 'missing point said %', sqlerrm; end if;
  end;
  begin
    perform public.trainer_search('near', 91, 0);
    raise exception 'near with a bad point';
  exception when others then
    if sqlerrm not like '%Choose a location.%' then raise exception 'bad point said %', sqlerrm; end if;
  end;
end $$;
`);

if (out.indexOf('ERROR') !== -1) {
  console.error(out);
  process.exit(1);
}
console.log('near sql ok');
