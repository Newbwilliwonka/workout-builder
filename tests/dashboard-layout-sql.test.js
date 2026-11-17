// Trainer's own dashboard layout, and the Strength card on a shared copy.
// Local Postgres only. Does not touch the live project.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const T = '11111111-1111-4111-8111-111111111111';
const M = '33333333-3333-4333-8333-333333333333';
const E = '77777777-7777-4777-8777-777777777777';
const C = '22222222-2222-4222-8222-222222222222';
const S = '44444444-4444-4444-8444-444444444444';

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

psql('postgres', 'drop database if exists wb_layout_test;\ncreate database wb_layout_test;\n');
psql('wb_layout_test', `
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
  'supabase/migrations/20261116180000_share_inbox_any_client.sql',
  'supabase/migrations/20261116210000_hide_other_emails.sql',
  'supabase/migrations/20261117010000_trainer_dashboard_layout.sql',
  'supabase/migrations/20261117120000_dashboard_holds_stopwatch.sql'
].forEach(function (file) { psql('wb_layout_test', null, path.join(root, file)); });

psql('wb_layout_test', `
insert into auth.users (id, email) values
  ('${T}', 'coach@example.com'),
  ('${M}', 'master@example.com'),
  ('${E}', 'fan@example.com'),
  ('${C}', 'ada@example.com'),
  ('${S}', 'stranger@example.com');
update public.profiles set membership = 'trainer', display_name = 'Coach Lee' where id = '${T}';
update public.profiles set membership = 'master_trainer', display_name = 'Master Lee' where id = '${M}';
update public.profiles set membership = 'enthusiast', display_name = 'Fan' where id = '${E}';
update public.profiles set membership = 'free_client', display_name = 'Ada' where id = '${C}';
update public.profiles set membership = 'trainer', display_name = 'Stranger' where id = '${S}';
insert into public.trainer_clients (trainer_id, client_id) values ('${T}', '${C}');

set role authenticated;
select set_config('request.jwt.claim.sub', '${T}', false);
insert into public.dashboard_layouts (user_id, cards) values
  ('${T}', '["plan","strength","workouts"]'::jsonb);
do $$
declare n int;
begin
  select count(*) into n from public.dashboard_layouts where user_id = '${T}';
  if n <> 1 then raise exception 'trainer cannot read their layout %', n; end if;
  if (select cards from public.dashboard_layouts where user_id = '${T}')::text not like '%strength%' then
    raise exception 'saved order dropped strength';
  end if;
end $$;
update public.dashboard_layouts set cards = '["strength","plan"]'::jsonb where user_id = '${T}';
do $$
begin
  if (select cards->>0 from public.dashboard_layouts where user_id = '${T}') is distinct from 'strength' then
    raise exception 'trainer cannot rearrange their layout';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '${M}', false);
insert into public.dashboard_layouts (user_id, cards) values ('${M}', '["plan"]'::jsonb);

select set_config('request.jwt.claim.sub', '${S}', false);
do $$
declare n int;
begin
  select count(*) into n from public.dashboard_layouts;
  if n <> 0 then raise exception 'another trainer can see a layout %', n; end if;
  begin
    insert into public.dashboard_layouts (user_id, cards) values ('${T}', '["plan"]'::jsonb);
    raise exception 'another trainer wrote a layout';
  exception when others then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${E}', false);
do $$
begin
  begin
    insert into public.dashboard_layouts (user_id, cards) values ('${E}', '["plan","workouts"]'::jsonb);
    raise exception 'an enthusiast saved a layout';
  exception when others then
    if sqlerrm not like '%Only a trainer%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${C}', false);
do $$
begin
  begin
    insert into public.dashboard_layouts (user_id, cards) values ('${C}', '["plan"]'::jsonb);
    raise exception 'a free client saved a layout';
  exception when others then
    if sqlerrm not like '%Only a trainer%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '${T}', false);
do $$
begin
  begin
    insert into public.dashboard_layouts (user_id, cards) values ('${T}', '["plan","nope"]'::jsonb);
    raise exception 'an unknown card was saved';
  exception when others then
    if sqlerrm not like '%Choose the cards%' then raise; end if;
  end;
  begin
    insert into public.dashboard_layouts (user_id, cards) values ('${T}', '["plan","plan"]'::jsonb);
    raise exception 'a duplicate card was saved';
  exception when others then
    if sqlerrm not like '%Each card is listed once%' then raise; end if;
  end;
  update public.dashboard_layouts
    set cards = '["plan","workouts","strength","volume","records","calendar","holds","stopwatch","pass"]'::jsonb
    where user_id = '${T}';
  if (select cards->>6 from public.dashboard_layouts where user_id = '${T}') is distinct from 'holds' then
    raise exception 'static holds was not saved';
  end if;
  if (select cards->>7 from public.dashboard_layouts where user_id = '${T}') is distinct from 'stopwatch' then
    raise exception 'stopwatch was not saved';
  end if;
  if jsonb_array_length((select cards from public.dashboard_layouts where user_id = '${T}')) <> 9 then
    raise exception 'nine layout cards did not fit';
  end if;
  begin
    update public.dashboard_layouts
      set cards = '["plan","workouts","strength","volume","records","calendar","holds","stopwatch","pass","plan"]'::jsonb
      where user_id = '${T}';
    raise exception 'a tenth layout card was saved';
  exception when others then
    if sqlerrm not like '%Choose the cards%' and sqlerrm not like '%Each card is listed once%' then raise; end if;
  end;
end $$;
delete from public.dashboard_layouts where user_id = '${T}';
do $$
declare n int;
begin
  select count(*) into n from public.dashboard_layouts where user_id = '${T}';
  if n <> 0 then raise exception 'reset left a layout %', n; end if;
end $$;

insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards) values (
  '${C}', '${T}', 'coach@example.com', '2026-11-16',
  '[
    {"type":"plan"},
    {"type":"workouts"},
    {"type":"strength"},
    {"type":"volume"},
    {"type":"records"},
    {"type":"calendar"},
    {"type":"holds"},
    {"type":"stopwatch"},
    {"type":"pass"}
  ]'::jsonb
);
do $$
declare n int;
begin
  select count(*) into n from public.shared_dashboards where client_id = '${C}' and trainer_id = '${T}';
  if n <> 1 then raise exception 'strength card was not shared %', n; end if;
  if (select trainer_name from public.shared_dashboards where client_id = '${C}') is distinct from 'Coach Lee' then
    raise exception 'email trainer name was stored';
  end if;
  if jsonb_array_length((select cards from public.shared_dashboards where client_id = '${C}')) <> 9 then
    raise exception 'nine cards did not fit';
  end if;
  if not exists (
    select 1 from public.shared_dashboards
    where client_id = '${C}'
      and cards @> '[{"type":"holds"},{"type":"stopwatch"}]'::jsonb
  ) then
    raise exception 'holds and stopwatch were not shared';
  end if;
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards) values (
      '${C}', '${T}', 'Coach Lee', '2026-11-18',
      '[{"type":"plan"},{"type":"workouts"},{"type":"strength"},{"type":"volume"},{"type":"records"},{"type":"calendar"},{"type":"holds"},{"type":"stopwatch"},{"type":"pass"},{"type":"plan"}]'::jsonb
    );
    raise exception 'a tenth shared card was stored';
  exception when others then
    if sqlerrm not like '%Choose the cards%' then raise; end if;
  end;
  begin
    insert into public.shared_dashboards (client_id, trainer_id, trainer_name, as_of, cards) values (
      '${C}', '${T}', 'Coach Lee', '2026-11-17',
      '[{"type":"plan"},{"type":"nope"}]'::jsonb
    );
    raise exception 'an unknown shared card was stored';
  exception when others then
    if sqlerrm not like '%Choose the cards%' then raise; end if;
  end;
end $$;
`);

console.log('DASHBOARD LAYOUT SQL OK');
