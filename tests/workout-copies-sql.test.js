// RLS, edit lock, and idempotent send. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const D2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const D3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

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

psql('postgres', 'drop database if exists wb_copies_test;\ncreate database wb_copies_test;\n');
psql('wb_copies_test', `
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
[
  'supabase/migrations/20261106150000_profiles.sql',
  'supabase/migrations/20261107160000_invites.sql',
  'supabase/migrations/20261111120000_messages.sql',
  'supabase/migrations/20261111140000_workout_copies.sql',
  'supabase/migrations/20261111140000_workout_copies.sql'
].forEach(function (file) { psql('wb_copies_test', null, path.join(root, file)); });

const assertSql = `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${C}', 'ada@example.com'),
  ('${E}', 'fan@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set membership = 'trainer', email = 'coach@example.com' where id = '${T}';
update public.profiles set membership = 'free_client', email = 'ada@example.com' where id = '${C}';
update public.profiles set membership = 'enthusiast', intended_plan = 'enthusiast', email = 'fan@example.com' where id = '${E}';
insert into public.trainer_clients (trainer_id, client_id) values
  ('${T}', '${C}'),
  ('${T}', '${E}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);

-- One send, two independent copies. The retry keeps the original items.
select public.workout_send(
  jsonb_build_array(
    jsonb_build_object('id', '${D1}', 'clientId', '${C}'),
    jsonb_build_object('id', '${D2}', 'clientId', '${E}')
  ),
  ' Friday full body ',
  '[{"name":"Squat","sets":3}]'::jsonb,
  'wo_friday'
);
select public.workout_send(
  jsonb_build_array(
    jsonb_build_object('id', '${D1}', 'clientId', '${C}'),
    jsonb_build_object('id', '${D2}', 'clientId', '${E}')
  ),
  'Changed',
  '[{"name":"Changed","sets":9}]'::jsonb,
  'wo_friday'
);

reset role;
do $$
declare n int; c_name text; e_name text; c_items text; e_items text;
begin
  select count(*) into n from public.workout_copies;
  if n <> 2 then raise exception 'row count %', n; end if;
  select name, items::text into c_name, c_items from public.workout_copies where id = '${D1}';
  select name, items::text into e_name, e_items from public.workout_copies where id = '${D2}';
  if c_name <> 'Friday full body' or e_name <> 'Friday full body' then
    raise exception 'retry changed the name % %', c_name, e_name;
  end if;
  if c_items <> e_items or position('Squat' in c_items) = 0 or position('Changed' in c_items) <> 0 then
    raise exception 'copies diverged or changed % %', c_items, e_items;
  end if;
  if (select source_workout_id from public.workout_copies where id = '${D1}') <> 'wo_friday' then
    raise exception 'source id missing';
  end if;
end $$;

-- The trainer cannot read the copies. Each client sees only their own.
set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_copies;
  if n <> 0 then raise exception 'trainer saw % copies', n; end if;
  if public.workout_mine() <> '[]'::jsonb then
    raise exception 'trainer mine %', public.workout_mine();
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
declare mine jsonb; n int;
begin
  select count(*) into n from public.workout_copies;
  if n <> 1 then raise exception 'free client saw %', n; end if;
  mine := public.workout_mine();
  if mine->0->>'name' <> 'Friday full body' then raise exception 'mine %', mine; end if;
  if mine->0->>'sourceTrainerEmail' <> 'coach@example.com' then raise exception 'from %', mine; end if;
  if position('Squat' in mine::text) = 0 then raise exception 'items %', mine; end if;
  begin
    perform public.workout_save('${D1}', 'Hack', '[{"name":"Hack"}]'::jsonb);
    raise exception 'free client save should fail';
  exception when others then
    if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
  end;
  begin
    perform public.workout_delete('${D1}');
    raise exception 'free client delete should fail';
  exception when others then
    if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
  end;
  update public.workout_copies set name = 'Hack' where id = '${D1}';
  if found then raise exception 'free client update was visible'; end if;
  begin
    perform public.workout_send(
      jsonb_build_array(jsonb_build_object('id', '${D3}', 'clientId', '${E}')),
      'Nope', '[]'::jsonb, ''
    );
    raise exception 'client send should fail';
  exception when others then
    if sqlerrm not like '%Only a trainer%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
declare saved jsonb; n int;
begin
  select count(*) into n from public.workout_copies;
  if n <> 1 then raise exception 'enthusiast saw %', n; end if;
  if (select id::text from public.workout_copies) <> '${D2}' then
    raise exception 'enthusiast saw the other copy';
  end if;
  saved := public.workout_save('${D2}', 'Friday edited', '[{"name":"Squat","sets":4}]'::jsonb);
  if saved->>'name' <> 'Friday edited' then raise exception 'save %', saved; end if;
  begin
    update public.workout_copies set trainer_id = '${S}' where id = '${D2}';
    raise exception 'reassign should fail';
  exception when others then
    if sqlerrm not like '%cannot be reassigned%' then raise; end if;
  end;
  begin
    perform public.workout_save('${D1}', 'Stolen', '[]'::jsonb);
    raise exception 'enthusiast edited the other copy';
  exception when others then
    if sqlerrm not like '%not found%' then raise; end if;
  end;
end $$;

reset role;
do $$
declare c_name text; e_name text; e_items text;
begin
  select name into c_name from public.workout_copies where id = '${D1}';
  select name, items::text into e_name, e_items from public.workout_copies where id = '${D2}';
  if c_name <> 'Friday full body' then raise exception 'free client copy changed %', c_name; end if;
  if e_name <> 'Friday edited' or position('"sets": 4' in e_items) = 0 then
    raise exception 'enthusiast edit missing % %', e_name, e_items;
  end if;
end $$;

-- The trigger rejects a Free Client edit even when row security is bypassed.
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  update public.workout_copies set name = 'Bypass' where id = '${D1}';
  raise exception 'trigger allowed a free client edit';
exception when others then
  if sqlerrm not like '%Only an Enthusiast%' then raise; end if;
end $$;

-- A direct insert still has to be from the trainer to a linked client.
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  insert into public.workout_copies (id, owner_id, trainer_id, name, items)
  values ('${D3}', '${C}', '${T}', 'Direct', '[]'::jsonb);
  raise exception 'client insert should fail';
exception when insufficient_privilege or check_violation then
  null;
when others then
  if sqlerrm not like '%linked client%' and sqlerrm not like '%permission denied%' and sqlerrm not like '%row-level%' then
    raise;
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.workout_copies;
  if n <> 0 then raise exception 'stranger saw %', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  perform public.workout_send(
    jsonb_build_array(jsonb_build_object('id', '${D3}', 'clientId', '${S}')),
    'Nope', '[]'::jsonb, ''
  );
  raise exception 'send to a stranger should fail';
exception when others then
  if sqlerrm not like '%linked client%' then raise; end if;
end $$;

reset role;
set role anon;
do $$
begin
  perform 1 from public.workout_copies;
  raise exception 'anon read should fail';
exception when insufficient_privilege then
  null;
end $$;

-- Ending the link hides the copy and blocks another send. The row stays.
reset role;
update public.trainer_clients set ended_at = now() where client_id = '${C}';
set role authenticated;
select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  if public.workout_mine() <> '[]'::jsonb then
    raise exception 'ended link still listed %', public.workout_mine();
  end if;
end $$;
select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  perform public.workout_send(
    jsonb_build_array(jsonb_build_object('id', '${D3}', 'clientId', '${C}')),
    'After', '[]'::jsonb, ''
  );
  raise exception 'send after disconnect should fail';
exception when others then
  if sqlerrm not like '%linked client%' then raise; end if;
end $$;

reset role;
do $$
declare n int;
begin
  select count(*) into n from public.workout_copies where id = '${D1}' and name = 'Friday full body';
  if n <> 1 then raise exception 'disconnect removed the copy'; end if;
  select count(*) into n from public.workout_copies where name = 'After' or name = 'Bypass' or name = 'Hack';
  if n <> 0 then raise exception 'rejected writes were stored'; end if;
end $$;
`;

const out = psql('wb_copies_test', assertSql);
console.log(out.trim().split('\n').slice(-12).join('\n'));
console.log('WORKOUT COPIES SQL OK');
