-- Red counts on Messages, Hub, and Tracking.
-- Apply once in the Supabase SQL editor AFTER 20261118190000_trainer_hub.sql
-- and 20261116150000_shared_dashboards.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Safe to run again. A second run does not duplicate the row, the policies,
-- or the functions. No inner transaction.
--
-- What it stores
--   public.nav_seen
--     One row per person. messages_at, hub_at, and tracking_at are the last
--     time they opened that part of the app. Nothing else is stored.
--
-- Who can see a row
--   Only that person can read or write the row. A trainer cannot read or
--   change a client's row. anon has no access.
--
-- What the counts are
--   Messages: unread messages already counted per sender (someone else sent
--   them, and read_at is still empty) that were created after messages_at.
--   Before Messages has been opened, that is the full unread total.
--   Hub: replies other people wrote on this person's own posts after hub_at.
--   Before Hub has been opened, that is every such reply.
--   Tracking: shared dashboards sent to this person. Before Tracking has
--   been opened, that is the ones not yet opened. After that, it is shared
--   dashboards created after tracking_at.
--   Opening a section stamps that column. It does not mark a message read
--   and it does not mark a dashboard viewed.

create table if not exists public.nav_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  messages_at timestamptz,
  hub_at timestamptz,
  tracking_at timestamptz
);

comment on table public.nav_seen is
  'When this person last opened Messages, Hub, and Tracking. Only they can read or write the row.';

alter table public.nav_seen enable row level security;

revoke all on public.nav_seen from public, anon, authenticated;
grant select, insert, update on public.nav_seen to authenticated;

drop policy if exists nav_seen_select on public.nav_seen;
create policy nav_seen_select
  on public.nav_seen
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists nav_seen_insert on public.nav_seen;
create policy nav_seen_insert
  on public.nav_seen
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists nav_seen_update on public.nav_seen;
create policy nav_seen_update
  on public.nav_seen
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.nav_badges()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  seen public.nav_seen;
  messages int := 0;
  hub int := 0;
  tracking int := 0;
begin
  if uid is null then
    return jsonb_build_object('messages', 0, 'hub', 0, 'tracking', 0);
  end if;
  select * into seen from public.nav_seen where user_id = uid;

  select count(*)::int into messages
  from public.messages m
  where (m.trainer_id = uid or m.client_id = uid)
    and m.sender_id <> uid
    and m.read_at is null
    and (seen.messages_at is null or m.created_at > seen.messages_at);

  select count(*)::int into hub
  from public.hub_replies r
  join public.hub_posts p on p.id = r.post_id
  where p.author_id = uid
    and r.author_id <> uid
    and (seen.hub_at is null or r.created_at > seen.hub_at);

  select count(*)::int into tracking
  from public.shared_dashboards d
  where d.client_id = uid
    and (
      (seen.tracking_at is null and d.viewed_at is null)
      or (seen.tracking_at is not null and d.created_at > seen.tracking_at)
    );

  return jsonb_build_object('messages', messages, 'hub', hub, 'tracking', tracking);
end;
$$;

create or replace function public.nav_mark_seen(p_section text)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  stamp timestamptz := now();
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if p_section is null or p_section not in ('messages', 'hub', 'tracking') then
    raise exception 'That section is not available.';
  end if;
  insert into public.nav_seen as n (user_id, messages_at, hub_at, tracking_at)
  values (
    uid,
    case when p_section = 'messages' then stamp else null end,
    case when p_section = 'hub' then stamp else null end,
    case when p_section = 'tracking' then stamp else null end
  )
  on conflict (user_id) do update set
    messages_at = case when p_section = 'messages' then stamp else n.messages_at end,
    hub_at = case when p_section = 'hub' then stamp else n.hub_at end,
    tracking_at = case when p_section = 'tracking' then stamp else n.tracking_at end;
  return stamp;
end;
$$;

revoke all on function public.nav_badges() from public, anon, authenticated;
revoke all on function public.nav_mark_seen(text) from public, anon, authenticated;
grant execute on function public.nav_badges() to authenticated;
grant execute on function public.nav_mark_seen(text) to authenticated;
