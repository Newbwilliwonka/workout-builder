// Linked trainer is first in Online and Near me. Local Postgres only.
// Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261123030000_trainer_search_linked_first.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
[
  'create or replace function public.trainer_search(',
  'p_mode text',
  'p_lat double precision default null',
  'p_lng double precision default null',
  'isLinked',
  'private.is_approved',
  'private.can_find_trainer',
  'trainer_temp_links',
  'ended_at is null',
  'limit 10',
  'comingSoon',
  'revoke all on function public.trainer_search(text, double precision, double precision) from public, anon',
  'grant execute on function public.trainer_search(text, double precision, double precision) to authenticated'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(!/trainer_email|client_email|profiles\.email|u\.email/.test(sqlText));

const ZARA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const TEMP = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const OLD = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const NIA = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const C1 = '12121212-1212-4121-8121-121212121212';
const C2 = '13131313-1313-4131-8131-131313131313';
const WAIT = '17171717-1717-4171-8171-171717171717';
const T1 = 'a0000000-0000-4000-8000-000000000001';

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

psql('postgres', 'drop database if exists wb_linked_test;\ncreate database wb_linked_test;\n');
psql('wb_linked_test', `
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
  psql('wb_linked_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_linked_test', null, path.join(root, migration));

const people = [
  [ZARA, 'zara@example.com', 'Zara Coach', 'trainer', false, 'online'],
  [TEMP, 'temp@example.com', 'Temp Coach', 'trainer', true, 'online'],
  [OLD, 'old@example.com', 'Old Coach', 'trainer', true, 'online'],
  [NIA, 'nia@example.com', 'Nia Coach', 'trainer', true, 'in_person'],
  [C1, 'ada@example.com', 'Ada Lee', 'free_client', false, null],
  [C2, 'beau@example.com', 'Beau Lee', 'free_client', false, null],
  [WAIT, 'wait@example.com', 'Pat Wait', 'free_client', false, null]
];

psql('wb_linked_test', `
insert into auth.users (id, email) values
${people.map(function (row) { return `('${row[0]}', '${row[1]}')`; }).join(',\n')};
${people.map(function (row) {
  const service = row[5] ? `'${row[5]}'` : 'null';
  const approved = row[0] === WAIT ? 'false' : 'true';
  return `update public.profiles set access_approved = ${approved}, membership = '${row[3]}', display_name = '${row[2]}', listed = ${row[4]}, service_type = ${service} where id = '${row[0]}';`;
}).join('\n')}
insert into public.trainer_clients (trainer_id, client_id, ended_at) values
  ('${OLD}', '${C1}', now());
insert into public.trainer_clients (trainer_id, client_id) values
  ('${ZARA}', '${C1}');
insert into public.trainer_temp_links (trainer_id, client_id, expires_at) values
  ('${TEMP}', '${C1}', now() + interval '7 days');
insert into private.trainer_locations (trainer_id, slot, latitude, longitude, city, region, country) values
  ('${NIA}', 1, 30.26715, -97.74310, 'Austin', 'Texas', 'United States');

do $$
declare i int;
  pid uuid;
begin
  for i in 1..12 loop
    pid := ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id, email) values (pid, 'trainer' || i || '@example.com');
    update public.profiles
      set access_approved = true,
          membership = 'trainer',
          display_name = 'Trainer ' || lpad(i::text, 2, '0'),
          listed = true,
          service_type = 'online'
      where id = pid;
  end loop;
  for i in 1..11 loop
    pid := ('b0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id, email) values (pid, 'near' || i || '@example.com');
    update public.profiles
      set access_approved = true,
          membership = 'trainer',
          display_name = 'Near ' || lpad(i::text, 2, '0'),
          listed = true,
          service_type = 'in_person'
      where id = pid;
    insert into private.trainer_locations (trainer_id, slot, latitude, longitude, city, region, country)
    values (pid, 1, 30.26715 + (i * 0.25), -97.74310, 'City ' || i, 'Texas', 'United States');
  end loop;
end $$;
`);

const out = psql('wb_linked_test', `
do $$
begin
  if has_function_privilege('anon', 'public.trainer_search(text, double precision, double precision)', 'execute') then
    raise exception 'anonymous role can search';
  end if;
  if not has_function_privilege('authenticated', 'public.trainer_search(text, double precision, double precision)', 'execute') then
    raise exception 'signed-in role cannot search';
  end if;
  if pg_get_functiondef('public.trainer_search(text, double precision, double precision)'::regprocedure) ilike '%email%' then
    raise exception 'trainer_search mentions email';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);

do $$
declare
  result jsonb;
  near jsonb;
  names text;
  item jsonb;
  n int;
  prev int;
  miles int;
begin
  result := public.trainer_search('online', null, null);
  if result->>'mode' <> 'online' or result->>'comingSoon' <> 'false' then
    raise exception 'online shape %', result;
  end if;
  if position('@' in result::text) > 0 then raise exception 'online leaked an email %', result; end if;
  if result::text like '%latitude%' or result::text like '%longitude%' or result::text like '%30.26715%' then
    raise exception 'online leaked a coordinate %', result;
  end if;
  if jsonb_array_length(result->'trainers') <> 11 then
    raise exception 'unlisted linked should add to 10, got %', result->'trainers';
  end if;
  if result->'trainers'->0->>'name' <> 'Zara Coach'
     or (result->'trainers'->0->>'isLinked')::boolean is not true
     or result->'trainers'->0->>'id' <> '${ZARA}' then
    raise exception 'linked was not first %', result->'trainers'->0;
  end if;
  if result->'trainers'->0 ? 'distanceMiles' then
    raise exception 'online linked has a distance %', result->'trainers'->0;
  end if;
  if result->'trainers'->0 ? 'email' or result->'trainers'->0 ? 'latitude' or result->'trainers'->0 ? 'country' then
    raise exception 'linked row has a private key %', result->'trainers'->0;
  end if;
  select count(*) into n from jsonb_array_elements(result->'trainers') elem where elem->>'id' = '${ZARA}';
  if n <> 1 then raise exception 'linked trainer appeared % times', n; end if;
  select string_agg(elem->>'name', '|' order by ord) into names
  from jsonb_array_elements(result->'trainers') with ordinality as t(elem, ord);
  if names <> 'Zara Coach|Old Coach|Trainer 01|Trainer 02|Trainer 03|Trainer 04|Trainer 05|Trainer 06|Trainer 07|Trainer 08|Trainer 09' then
    raise exception 'online rank %', names;
  end if;
  if names like '%Temp Coach%' or names like '%Nia Coach%' or names like '%Trainer 10%' or names like '%Near %' then
    raise exception 'online included someone hidden %', names;
  end if;
  for item in select t.value from jsonb_array_elements(result->'trainers') as t(value) offset 1 loop
    if (item->>'isLinked')::boolean is not false then
      raise exception 'other row marked linked %', item;
    end if;
    if item ? 'email' or item ? 'latitude' or item ? 'longitude' then
      raise exception 'other row has a private key %', item;
    end if;
  end loop;

  near := public.trainer_search('near', 30.26715, -97.74310);
  if near->>'mode' <> 'near' or near->>'comingSoon' <> 'false' then
    raise exception 'near shape %', near;
  end if;
  if jsonb_array_length(near->'trainers') <> 11 then
    raise exception 'near count %', near->'trainers';
  end if;
  if near->'trainers'->0->>'name' <> 'Zara Coach'
     or (near->'trainers'->0->>'isLinked')::boolean is not true then
    raise exception 'near linked was not first %', near->'trainers'->0;
  end if;
  if near->'trainers'->0->>'serviceType' <> 'online' then
    raise exception 'near linked service %', near->'trainers'->0->>'serviceType';
  end if;
  if near->'trainers'->0 ? 'distanceMiles' then
    raise exception 'near linked without a pin has a distance %', near->'trainers'->0;
  end if;
  if position('@' in near::text) > 0
     or near::text like '%30.26715%'
     or near::text like '%latitude%'
     or near::text like '%longitude%'
     or near::text like '%-97.74310%' then
    raise exception 'near leaked a private field %', near;
  end if;
  select count(*) into n from jsonb_array_elements(near->'trainers') elem where elem->>'id' = '${ZARA}';
  if n <> 1 then raise exception 'near linked appeared % times', n; end if;
  select string_agg(elem->>'name', '|' order by ord) into names
  from jsonb_array_elements(near->'trainers') with ordinality as t(elem, ord);
  if split_part(names, '|', 2) <> 'Nia Coach' then raise exception 'closest other %', names; end if;
  if names like '%Near 10%' or names like '%Near 11%' or names like '%Temp Coach%' or names like '%Old Coach%' or names like '%Trainer %' then
    raise exception 'near included someone hidden %', names;
  end if;
  prev := 0;
  for item in select t.value from jsonb_array_elements(near->'trainers') as t(value) offset 1 loop
    if (item->>'isLinked')::boolean is not false then raise exception 'near other marked linked %', item; end if;
    if item ? 'email' or item ? 'latitude' or item ? 'longitude' or item ? 'country' then
      raise exception 'near other has a private key %', item;
    end if;
    miles := (item->>'distanceMiles')::int;
    if miles < prev or miles < 1 then raise exception 'near distance %', item; end if;
    prev := miles;
  end loop;
  if (near->'trainers'->1->>'distanceMiles')::int <> 1 then
    raise exception 'same-point distance %', near->'trainers'->1->>'distanceMiles';
  end if;

end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles
  set listed = true, service_type = 'online'
  where id = '${ZARA}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare result jsonb; n int;
begin
  result := public.trainer_search('online', null, null);
  if jsonb_array_length(result->'trainers') <> 11 then
    raise exception 'listed linked counted against the top 10 %', result->'trainers';
  end if;
  if result->'trainers'->0->>'id' <> '${ZARA}' or (result->'trainers'->0->>'isLinked')::boolean is not true then
    raise exception 'listed linked was not first %', result->'trainers'->0;
  end if;
  select count(*) into n from jsonb_array_elements(result->'trainers') elem where elem->>'id' = '${ZARA}';
  if n <> 1 then raise exception 'listed linked appeared % times', n; end if;
  if result->'trainers'->10->>'name' <> 'Trainer 09' then
    raise exception 'linked trainer took a top-10 spot %', result->'trainers'->10->>'name';
  end if;
  if position('@' in result::text) > 0 then raise exception 'listed search leaked an email'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into private.trainer_locations (trainer_id, slot, latitude, longitude, city, region, country)
values ('${ZARA}', 1, 40.71280, -74.00600, 'Farway', 'New York', 'United States');

set role authenticated;
select set_config('request.jwt.claim.sub', '${C1}', false);
do $$
declare near jsonb; n int;
begin
  near := public.trainer_search('near', 30.26715, -97.74310);
  if near->'trainers'->0->>'id' <> '${ZARA}' or (near->'trainers'->0->>'isLinked')::boolean is not true then
    raise exception 'far linked was not first %', near->'trainers'->0;
  end if;
  if near->'trainers'->0->>'city' <> 'Farway' or near->'trainers'->0->>'state' <> 'New York' then
    raise exception 'far linked place %', near->'trainers'->0;
  end if;
  if (near->'trainers'->0->>'distanceMiles')::int <= (near->'trainers'->1->>'distanceMiles')::int then
    raise exception 'far linked should still lead %', near->'trainers'->0->>'distanceMiles';
  end if;
  select count(*) into n from jsonb_array_elements(near->'trainers') elem where elem->>'id' = '${ZARA}';
  if n <> 1 then raise exception 'far linked appeared % times', n; end if;
  if jsonb_array_length(near->'trainers') <> 11 then
    raise exception 'far linked changed the other count %', jsonb_array_length(near->'trainers');
  end if;
  if near::text like '%40.71280%' or near::text like '%-74.00600%' or position('@' in near::text) > 0 then
    raise exception 'far pin leaked %', near->'trainers'->0;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set listed = false, service_type = 'online' where id = '${ZARA}';

set role authenticated;
select set_config('request.jwt.claim.sub', '${C2}', false);
do $$
declare result jsonb; item jsonb;
begin
  result := public.trainer_search('online', null, null);
  if result::text like '%Zara Coach%' then raise exception 'unlinked client saw a hidden trainer'; end if;
  if jsonb_array_length(result->'trainers') <> 10 then
    raise exception 'unlinked count %', jsonb_array_length(result->'trainers');
  end if;
  if result->'trainers'->0->>'name' <> 'Old Coach' or (result->'trainers'->0->>'isLinked')::boolean then
    raise exception 'unlinked first %', result->'trainers'->0;
  end if;
  if position('@' in result::text) > 0 then raise exception 'unlinked search leaked an email'; end if;
  perform public.trainer_request_send('${T1}'::uuid, 'Hello');
  result := public.trainer_search('online', null, null);
  select elem into item from jsonb_array_elements(result->'trainers') elem where elem->>'id' = '${T1}';
  if item->>'request' <> 'open' or (item->>'isLinked')::boolean then
    raise exception 'request state %', item;
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${TEMP}', false);
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
    perform public.trainer_search('near', 30.26715, -97.74310);
    raise exception 'waiting account searched';
  exception when others then
    if sqlerrm not like '%waiting for approval%' then raise exception 'waiting search said %', sqlerrm; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C2}', false);
do $$
begin
  begin
    perform public.trainer_search('near', null, null);
    raise exception 'near without a point';
  exception when others then
    if sqlerrm not like '%Choose a location.%' then raise exception 'missing point said %', sqlerrm; end if;
  end;
  begin
    perform public.trainer_search('somewhere', null, null);
    raise exception 'bad mode searched';
  exception when others then
    if sqlerrm not like '%Choose online or near me.%' then raise exception 'bad mode said %', sqlerrm; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform public.trainer_search('online', null, null);
    raise exception 'signed-out search';
  exception when others then
    if sqlerrm not like '%Sign in first.%' then raise exception 'signed-out said %', sqlerrm; end if;
  end;
end $$;
`);

if (out.indexOf('ERROR') !== -1) {
  console.error(out);
  process.exit(1);
}
console.log('linked sql ok');
