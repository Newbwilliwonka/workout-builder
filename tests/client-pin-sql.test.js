// Private client pins. Local Postgres only. Does not touch the live project.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = 'supabase/migrations/20261123040000_client_pin.sql';
const sqlText = fs.readFileSync(path.join(root, migration), 'utf8');
[
  'private.client_locations',
  'public.my_client_location',
  'public.save_client_location',
  'public.remove_client_location',
  'client_locations_owner',
  'grant select, insert, update, delete on table private.client_locations to authenticated',
  'revoke all on table private.client_locations from public, anon, authenticated',
  'A location pin is for clients and enthusiasts.'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(sqlText.indexOf('create or replace function public.trainer_search') === -1);
assert.ok(sqlText.indexOf("'email'") === -1);
assert.ok(/does not change trainer_search/i.test(sqlText));
assert.ok(/on conflict \(client_id\)/i.test(sqlText));

const ADA = '12121212-1212-4121-8121-121212121212';
const FAN = '14141414-1414-4141-8141-141414141414';
const INTENDED = '15151515-1515-4151-8151-151515151515';
const SWITCH = '16161616-1616-4161-8161-161616161616';
const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER = '17171717-1717-4171-8171-171717171717';
const WAIT = '18181818-1818-4181-8181-181818181818';

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

psql('postgres', 'drop database if exists wb_client_pin_test;\ncreate database wb_client_pin_test;\n');
psql('wb_client_pin_test', `
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
  psql('wb_client_pin_test', null, path.join(root, 'supabase/migrations', name));
});
psql('wb_client_pin_test', null, path.join(root, migration));

const people = [
  [ADA, 'ada@example.com', 'Casey Nguyen', 'free_client', null, true],
  [FAN, 'fan@example.com', 'Fan Lee', 'enthusiast', null, true],
  [INTENDED, 'intended@example.com', 'Intended Fan', 'none', 'enthusiast', true],
  [SWITCH, 'switch@example.com', 'Future Coach', 'enthusiast', 'trainer', true],
  [COACH, 'coach@example.com', 'Riley Coach', 'trainer', null, true],
  [OTHER, 'other@example.com', 'Other Client', 'free_client', null, true],
  [WAIT, 'wait@example.com', 'Waiting Client', 'free_client', null, false]
];

psql('wb_client_pin_test', `
insert into auth.users (id, email) values
${people.map(function (row) { return `('${row[0]}', '${row[1]}')`; }).join(',\n')};
${people.map(function (row) {
  const intended = row[4] ? `'${row[4]}'` : 'null';
  return `update public.profiles set access_approved = ${row[5]}, membership = '${row[3]}', intended_plan = ${intended}, display_name = '${row[2]}', listed = false, service_type = null where id = '${row[0]}';`;
}).join('\n')}
update public.profiles
  set listed = true, service_type = 'in_person', membership = 'trainer'
  where id = '${COACH}';
insert into private.trainer_locations (trainer_id, slot, latitude, longitude, city, region, country)
values ('${COACH}', 1, 30.26715, -97.74310, 'Austin', 'Texas', 'United States');
`);

const out = psql('wb_client_pin_test', `
do $$
declare args text; src text;
begin
  if not has_table_privilege('authenticated', 'private.client_locations', 'select')
     or not has_table_privilege('authenticated', 'private.client_locations', 'insert')
     or not has_table_privilege('authenticated', 'private.client_locations', 'update')
     or not has_table_privilege('authenticated', 'private.client_locations', 'delete') then
    raise exception 'owner cannot read and write their pin';
  end if;
  if has_table_privilege('anon', 'private.client_locations', 'select')
     or has_table_privilege('anon', 'private.client_locations', 'insert')
     or has_table_privilege('anon', 'private.client_locations', 'update')
     or has_table_privilege('anon', 'private.client_locations', 'delete')
     or has_function_privilege('anon', 'public.my_client_location()', 'execute')
     or has_function_privilege('anon', 'public.save_client_location(double precision, double precision, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.remove_client_location()', 'execute') then
    raise exception 'anon can touch a client pin';
  end if;
  select pg_get_function_identity_arguments(p.oid) into args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'trainer_search';
  if args is distinct from 'p_mode text, p_lat double precision, p_lng double precision' then
    raise exception 'trainer_search signature changed %', args;
  end if;
  src := pg_get_functiondef('public.trainer_search(text, double precision, double precision)'::regprocedure);
  if position('isLinked' in src) = 0 then
    raise exception 'linked-first search was replaced';
  end if;
  if position('client_locations' in src) > 0 then
    raise exception 'trainer_search reads client pins';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '${ADA}', false);

do $$
declare saved jsonb; again jsonb; mine jsonb; near jsonb; n int;
begin
  if public.my_client_location() is not null then
    raise exception 'empty pin was %', public.my_client_location();
  end if;
  begin
    perform public.save_service_location(44.9778, -93.2650, 'Hidden Harbor', 'Minnesota', 'United States');
    raise exception 'client saved a service pin';
  exception when others then
    if sqlerrm not like '%Only a Trainer or Master Trainer%' then
      raise exception 'client service pin said %', sqlerrm;
    end if;
  end;

  saved := public.save_client_location(44.9778, -93.2650, ' Hidden Harbor ', 'Minnesota', 'United States');
  if saved->>'city' <> 'Hidden Harbor' or saved->>'region' <> 'Minnesota' then
    raise exception 'save %', saved;
  end if;
  if position('@' in saved::text) > 0 or saved ? 'email' then
    raise exception 'save leaked email %', saved;
  end if;
  again := public.save_client_location(44.9800, -93.2700, 'Hidden Harbor', 'Minnesota', 'United States');
  if again->>'id' is distinct from saved->>'id' then
    raise exception 'second save created another pin %', again;
  end if;
  if (again->>'latitude')::float8 <> 44.98 then
    raise exception 'second save kept the old point %', again;
  end if;
  select count(*) into n from private.client_locations where client_id = '${ADA}';
  if n <> 1 then raise exception 'pin count %', n; end if;

  mine := public.my_client_location();
  if mine->>'city' <> 'Hidden Harbor' or (mine->>'longitude')::float8 <> -93.27 then
    raise exception 'own pin %', mine;
  end if;
  if position('@' in mine::text) > 0 then raise exception 'read leaked email %', mine; end if;

  near := public.trainer_search('near', (mine->>'latitude')::float8, (mine->>'longitude')::float8);
  if near->>'mode' <> 'near' then raise exception 'near mode %', near; end if;
  if position('@' in near::text) > 0 or position('Hidden Harbor' in near::text) > 0
     or position('44.98' in near::text) > 0 or position('latitude' in near::text) > 0 then
    raise exception 'search leaked the client pin %', near;
  end if;
  if near->'trainers'->0->>'name' <> 'Riley Coach' or near->'trainers'->0->>'city' <> 'Austin' then
    raise exception 'near trainer %', near->'trainers';
  end if;
  if near->'trainers'->0->>'isLinked' <> 'false' then
    raise exception 'linked flag %', near->'trainers'->0;
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${OTHER}', false);
do $$
declare n int;
begin
  if public.my_client_location() is not null then
    raise exception 'other client read a pin %', public.my_client_location();
  end if;
  select count(*) into n from private.client_locations;
  if n <> 0 then raise exception 'other client saw % rows', n; end if;
  begin
    insert into private.client_locations (client_id, latitude, longitude, city, region, country)
    values ('${ADA}', 1, 2, 'Nope', 'Texas', 'United States');
    raise exception 'inserted another person pin';
  exception when others then
    if sqlerrm not like '%row-level security%' then
      raise exception 'cross insert said %', sqlerrm;
    end if;
  end;
  update private.client_locations set city = 'Stolen' where client_id = '${ADA}';
  if found then raise exception 'updated another person pin'; end if;
end $$;

select set_config('request.jwt.claim.sub', '${ADA}', false);
do $$
declare n int;
begin
  select count(*) into n from private.client_locations;
  if n <> 1 then raise exception 'owner lost the pin %', n; end if;
  if (select city from private.client_locations) <> 'Hidden Harbor' then
    raise exception 'owner city changed';
  end if;
  if public.remove_client_location()->>'removed' <> 'true' then
    raise exception 'remove failed';
  end if;
  if public.my_client_location() is not null then
    raise exception 'pin remained %', public.my_client_location();
  end if;
  select count(*) into n from private.client_locations;
  if n <> 0 then raise exception 'row remained %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${FAN}', false);
do $$
declare saved jsonb;
begin
  saved := public.save_client_location(30.2672, -97.7431, 'Austin', 'Texas', 'United States');
  if saved->>'city' <> 'Austin' then raise exception 'enthusiast pin %', saved; end if;
  if public.remove_client_location()->>'removed' <> 'true' then
    raise exception 'enthusiast remove failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${INTENDED}', false);
do $$
declare saved jsonb;
begin
  saved := public.save_client_location(32.7767, -96.7970, 'Dallas', 'Texas', 'United States');
  if saved->>'city' <> 'Dallas' then raise exception 'intended pin %', saved; end if;
end $$;

select set_config('request.jwt.claim.sub', '${SWITCH}', false);
do $$
begin
  begin
    perform public.save_client_location(30, -97, 'Austin', 'Texas', 'United States');
    raise exception 'future trainer saved a client pin';
  exception when others then
    if sqlerrm not like '%clients and enthusiasts%' then
      raise exception 'future trainer said %', sqlerrm;
    end if;
  end;
  if public.my_client_location() is not null then
    raise exception 'future trainer read a pin';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${COACH}', false);
do $$
declare n int;
begin
  begin
    perform public.save_client_location(30.1, -97.1, 'Austin', 'Texas', 'United States');
    raise exception 'trainer saved a client pin';
  exception when others then
    if sqlerrm not like '%clients and enthusiasts%' then
      raise exception 'trainer pin said %', sqlerrm;
    end if;
  end;
  if public.my_client_location() is not null then
    raise exception 'trainer read a client pin %', public.my_client_location();
  end if;
  select count(*) into n from private.client_locations;
  if n <> 0 then raise exception 'trainer saw % client rows', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${WAIT}', false);
do $$
begin
  begin
    perform public.save_client_location(30, -97, 'Austin', 'Texas', 'United States');
    raise exception 'unapproved client saved a pin';
  exception when others then
    if sqlerrm not like '%waiting for approval%' then
      raise exception 'unapproved said %', sqlerrm;
    end if;
  end;
end $$;

reset role;
do $$
declare n int;
begin
  select count(*) into n from private.trainer_locations where trainer_id = '${COACH}';
  if n <> 1 then raise exception 'service pin changed %', n; end if;
  select count(*) into n from private.client_locations where client_id = '${INTENDED}';
  if n <> 1 then raise exception 'intended pin missing %', n; end if;
  if (select city from private.client_locations where client_id = '${COACH}') is not null then
    raise exception 'trainer has a client pin';
  end if;
end $$;

set role anon;
do $$
begin
  begin
    perform public.my_client_location();
    raise exception 'anon read a pin';
  exception when insufficient_privilege then
    null;
  end;
end $$;
`);

if (out.indexOf('ERROR') !== -1) {
  console.error(out);
  process.exit(1);
}
console.log('client pin sql ok');
