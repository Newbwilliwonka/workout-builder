-- Trainer Hub, a forum for every approved account.
-- Apply once in the Supabase SQL editor AFTER 20261117180000_invite_only_access.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Safe to run again. A second run does not duplicate rows, policies, or indexes.
--
-- What it creates
--   private.hub_events
--     One row each time someone writes a post, a reply, or a report.
--     No API access. Deleting a post does not remove the row, so the
--     hourly cap cannot be reset by deleting. Rows older than an hour
--     are removed when that person writes again.
--   public.hub_posts
--     id, author_id, title (1–120), body (1–4000), created_at, updated_at,
--     activity_at. activity_at starts at the post and moves forward when
--     a reply is added. The list is newest activity first.
--   public.hub_replies
--     id, post_id, author_id, body (1–2000), created_at, updated_at.
--   public.hub_reports
--     id, reporter_id, post_id, reply_id (null when the report is about
--     the post itself), status (open or dismissed), created_at, reviewed_at.
--     One open report per person per post, and one per person per reply.
--   public.hub_feed
--     Posts for approved accounts. Author display name, role, and verified
--     flag only. No email column.
--   public.hub_reply_feed
--     Replies for approved accounts. Same author fields. No email column.
--   public.hub_report_queue
--     Open reports for the admin page. Author and reporter display names
--     and roles only. Empty for everyone who is not the admin. No email column.
--   private.hub_author(uuid)
--     The name and role shown in the hub. A display name that contains @
--     is replaced with the role label. It does not return an email.
--   Triggers
--     Authors write only as themselves. Timestamps are set by the database.
--     A reply moves the post's activity_at. Deleting a post removes its
--     replies and reports. Caps, checked in the database:
--       5 posts, 20 replies, and 10 reports per person per hour.
--   Policies
--     anon has no access. authenticated can read and write only when
--     private.is_approved is true. A person can update only their own
--     posts and replies. They can delete only their own. The admin can
--     delete any post or reply and is the only role that can read or
--     dismiss reports.
--   Indexes
--     hub_posts (activity_at desc, id desc)
--     hub_posts (author_id, created_at desc)
--     hub_replies (post_id, created_at, id)
--     hub_replies (author_id, created_at desc)
--     hub_reports open queue, plus one-open-report uniqueness
--     hub_events (user_id, kind, created_at desc)

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.hub_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint hub_events_kind check (kind in ('post', 'reply', 'report'))
);

revoke all on table private.hub_events from public, anon, authenticated;

create index if not exists hub_events_recent_idx
  on private.hub_events (user_id, kind, created_at desc);

create table if not exists public.hub_posts (
  id uuid primary key,
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activity_at timestamptz not null default now()
);

create table if not exists public.hub_replies (
  id uuid primary key,
  post_id uuid not null references public.hub_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hub_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.hub_posts (id) on delete cascade,
  reply_id uuid references public.hub_replies (id) on delete cascade,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hub_posts_title_len' and conrelid = 'public.hub_posts'::regclass
  ) then
    alter table public.hub_posts
      add constraint hub_posts_title_len check (char_length(title) between 1 and 120);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'hub_posts_body_len' and conrelid = 'public.hub_posts'::regclass
  ) then
    alter table public.hub_posts
      add constraint hub_posts_body_len check (char_length(body) between 1 and 4000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'hub_replies_body_len' and conrelid = 'public.hub_replies'::regclass
  ) then
    alter table public.hub_replies
      add constraint hub_replies_body_len check (char_length(body) between 1 and 2000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'hub_reports_status' and conrelid = 'public.hub_reports'::regclass
  ) then
    alter table public.hub_reports
      add constraint hub_reports_status check (status in ('open', 'dismissed'));
  end if;
end
$constraints$;

create index if not exists hub_posts_activity_idx
  on public.hub_posts (activity_at desc, id desc);

create index if not exists hub_posts_author_idx
  on public.hub_posts (author_id, created_at desc);

create index if not exists hub_replies_post_idx
  on public.hub_replies (post_id, created_at, id);

create index if not exists hub_replies_author_idx
  on public.hub_replies (author_id, created_at desc);

create index if not exists hub_reports_open_idx
  on public.hub_reports (created_at)
  where status = 'open';

create unique index if not exists hub_reports_one_open_post
  on public.hub_reports (reporter_id, post_id)
  where reply_id is null and status = 'open';

create unique index if not exists hub_reports_one_open_reply
  on public.hub_reports (reporter_id, reply_id)
  where reply_id is not null and status = 'open';

-- Name and role for someone who has posted, for the signed-in person, or for the admin.
-- Never an email. A saved name that contains @ is not used.
create or replace function private.hub_author(uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  who uuid := (select auth.uid());
  person public.profiles;
  role_label text;
  name_fallback text;
  visible boolean;
begin
  if uid is null then
    return null;
  end if;
  visible := private.is_admin()
    or who = uid
    or (
      private.is_approved(who)
      and (
        exists (select 1 from public.hub_posts p where p.author_id = uid)
        or exists (select 1 from public.hub_replies r where r.author_id = uid)
      )
    );
  if not coalesce(visible, false) then
    return null;
  end if;
  select * into person from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('name', 'Member', 'role', 'Member', 'verified', false);
  end if;
  role_label := case person.membership
    when 'free_client' then 'Free Client'
    when 'enthusiast' then 'Enthusiast'
    when 'trainer' then 'Trainer'
    when 'master_trainer' then 'Master Trainer'
    else 'Member'
  end;
  name_fallback := case person.membership
    when 'free_client' then 'Client'
    when 'enthusiast' then 'Enthusiast'
    when 'trainer' then 'Trainer'
    when 'master_trainer' then 'Trainer'
    else 'Member'
  end;
  return jsonb_build_object(
    'name', private.shown_name(person.display_name, name_fallback),
    'role', role_label,
    'verified', coalesce(
      person.membership = 'master_trainer'
      and person.verified_until is not null
      and person.verified_until >= current_date,
      false
    )
  );
end;
$fn$;

revoke all on function private.hub_author(uuid) from public, anon, authenticated;
grant execute on function private.hub_author(uuid) to authenticated;

create or replace function private.hub_note_write(uid uuid, write_kind text, cap int, too_many text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  n int;
begin
  delete from private.hub_events
  where user_id = uid
    and kind = write_kind
    and created_at < now() - interval '1 hour';
  insert into private.hub_events (user_id, kind) values (uid, write_kind);
  select count(*) into n
  from private.hub_events
  where user_id = uid
    and kind = write_kind
    and created_at > now() - interval '1 hour';
  if n > cap then
    raise exception '%', too_many;
  end if;
end;
$fn$;

revoke all on function private.hub_note_write(uuid, text, int, text) from public, anon, authenticated;

create or replace function private.hub_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from uid then
      raise exception 'You can only post as yourself.';
    end if;
    new.title := btrim(coalesce(new.title, ''));
    new.body := btrim(coalesce(new.body, ''));
    if char_length(new.title) < 1 then
      raise exception 'Enter a title.';
    end if;
    if char_length(new.title) > 120 then
      raise exception 'That title is too long.';
    end if;
    if char_length(new.body) < 1 then
      raise exception 'Enter a post.';
    end if;
    if char_length(new.body) > 4000 then
      raise exception 'That post is too long.';
    end if;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    perform private.hub_note_write(uid, 'post', 5, 'You can post again in a little while.');
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if current_setting('app.hub_activity', true) = 'on' then
      if new.id is distinct from old.id
         or new.author_id is distinct from old.author_id
         or new.title is distinct from old.title
         or new.body is distinct from old.body
         or new.created_at is distinct from old.created_at
         or new.updated_at is distinct from old.updated_at then
        raise exception 'You can only edit your own post.';
      end if;
      new.activity_at := now();
      return new;
    end if;
    if old.author_id is distinct from uid then
      raise exception 'You can only edit your own post.';
    end if;
    if new.id is distinct from old.id
       or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception 'You can only edit your own post.';
    end if;
    new.title := btrim(coalesce(new.title, ''));
    new.body := btrim(coalesce(new.body, ''));
    if char_length(new.title) < 1 then
      raise exception 'Enter a title.';
    end if;
    if char_length(new.title) > 120 then
      raise exception 'That title is too long.';
    end if;
    if char_length(new.body) < 1 then
      raise exception 'Enter a post.';
    end if;
    if char_length(new.body) > 4000 then
      raise exception 'That post is too long.';
    end if;
    new.activity_at := old.activity_at;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.author_id is distinct from uid and not private.is_admin() then
      raise exception 'You can only delete your own post.';
    end if;
    perform set_config('app.hub_cleanup', 'on', true);
    delete from public.hub_reports where post_id = old.id;
    delete from public.hub_replies where post_id = old.id;
    perform set_config('app.hub_cleanup', 'off', true);
    return old;
  end if;
  return null;
end;
$fn$;

revoke all on function private.hub_posts_guard() from public, anon, authenticated;

create or replace function private.hub_replies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  cleaning boolean := current_setting('app.hub_cleanup', true) = 'on';
begin
  if uid is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from uid then
      raise exception 'You can only reply as yourself.';
    end if;
    if not exists (select 1 from public.hub_posts p where p.id = new.post_id) then
      raise exception 'That post is not available.';
    end if;
    new.body := btrim(coalesce(new.body, ''));
    if char_length(new.body) < 1 then
      raise exception 'Enter a reply.';
    end if;
    if char_length(new.body) > 2000 then
      raise exception 'That reply is too long.';
    end if;
    new.created_at := now();
    new.updated_at := now();
    perform private.hub_note_write(uid, 'reply', 20, 'You can reply again in a little while.');
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.author_id is distinct from uid then
      raise exception 'You can only edit your own reply.';
    end if;
    if new.id is distinct from old.id
       or new.post_id is distinct from old.post_id
       or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception 'You can only edit your own reply.';
    end if;
    new.body := btrim(coalesce(new.body, ''));
    if char_length(new.body) < 1 then
      raise exception 'Enter a reply.';
    end if;
    if char_length(new.body) > 2000 then
      raise exception 'That reply is too long.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not cleaning and old.author_id is distinct from uid and not private.is_admin() then
      raise exception 'You can only delete your own reply.';
    end if;
    if not cleaning then
      perform set_config('app.hub_cleanup', 'on', true);
    end if;
    delete from public.hub_reports where reply_id = old.id;
    if not cleaning then
      perform set_config('app.hub_cleanup', 'off', true);
    end if;
    return old;
  end if;
  return null;
end;
$fn$;

revoke all on function private.hub_replies_guard() from public, anon, authenticated;

create or replace function private.hub_reply_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform set_config('app.hub_activity', 'on', true);
  update public.hub_posts set activity_at = now() where id = new.post_id;
  perform set_config('app.hub_activity', 'off', true);
  return null;
end;
$fn$;

revoke all on function private.hub_reply_bump() from public, anon, authenticated;

create or replace function private.hub_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  cleaning boolean := current_setting('app.hub_cleanup', true) = 'on';
begin
  if uid is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not private.is_approved(uid) then
      raise exception 'Your account is waiting for approval.';
    end if;
    if new.reporter_id is distinct from uid then
      raise exception 'You can only report as yourself.';
    end if;
    if new.post_id is null or not exists (select 1 from public.hub_posts p where p.id = new.post_id) then
      raise exception 'That post is not available.';
    end if;
    if new.reply_id is null then
      if exists (select 1 from public.hub_posts p where p.id = new.post_id and p.author_id = uid) then
        raise exception 'You cannot report your own post.';
      end if;
      if exists (
        select 1 from public.hub_reports r
        where r.reporter_id = uid and r.post_id = new.post_id and r.reply_id is null and r.status = 'open'
      ) then
        raise exception 'You already reported this.';
      end if;
    else
      if not exists (
        select 1 from public.hub_replies y
        where y.id = new.reply_id and y.post_id = new.post_id
      ) then
        raise exception 'That reply is not available.';
      end if;
      if exists (select 1 from public.hub_replies y where y.id = new.reply_id and y.author_id = uid) then
        raise exception 'You cannot report your own reply.';
      end if;
      if exists (
        select 1 from public.hub_reports r
        where r.reporter_id = uid and r.reply_id = new.reply_id and r.status = 'open'
      ) then
        raise exception 'You already reported this.';
      end if;
    end if;
    new.status := 'open';
    new.reviewed_at := null;
    new.created_at := now();
    perform private.hub_note_write(uid, 'report', 10, 'You can report again in a little while.');
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not private.is_admin() then
      raise exception 'Only the admin can review a report.';
    end if;
    if new.id is distinct from old.id
       or new.reporter_id is distinct from old.reporter_id
       or new.post_id is distinct from old.post_id
       or new.reply_id is distinct from old.reply_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Only the review can change.';
    end if;
    if old.status is distinct from 'open' or new.status is distinct from 'dismissed' then
      raise exception 'That report is already reviewed.';
    end if;
    new.reviewed_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if cleaning or private.is_admin() then
      return old;
    end if;
    if exists (select 1 from public.hub_posts p where p.id = old.post_id and p.author_id = uid) then
      return old;
    end if;
    if old.reply_id is not null and exists (
      select 1 from public.hub_replies y where y.id = old.reply_id and y.author_id = uid
    ) then
      return old;
    end if;
    raise exception 'Only the admin can delete a report.';
  end if;
  return null;
end;
$fn$;

revoke all on function private.hub_reports_guard() from public, anon, authenticated;

drop trigger if exists hub_posts_guard on public.hub_posts;
create trigger hub_posts_guard
  before insert or update or delete on public.hub_posts
  for each row execute function private.hub_posts_guard();

drop trigger if exists hub_replies_guard on public.hub_replies;
create trigger hub_replies_guard
  before insert or update or delete on public.hub_replies
  for each row execute function private.hub_replies_guard();

drop trigger if exists hub_replies_bump on public.hub_replies;
create trigger hub_replies_bump
  after insert on public.hub_replies
  for each row execute function private.hub_reply_bump();

drop trigger if exists hub_reports_guard on public.hub_reports;
create trigger hub_reports_guard
  before insert or update or delete on public.hub_reports
  for each row execute function private.hub_reports_guard();

alter table public.hub_posts enable row level security;
alter table public.hub_replies enable row level security;
alter table public.hub_reports enable row level security;

revoke all on public.hub_posts from public, anon, authenticated;
revoke all on public.hub_replies from public, anon, authenticated;
revoke all on public.hub_reports from public, anon, authenticated;
grant select, insert, update, delete on public.hub_posts to authenticated;
grant select, insert, update, delete on public.hub_replies to authenticated;
grant select, insert, update, delete on public.hub_reports to authenticated;

drop policy if exists hub_posts_select on public.hub_posts;
create policy hub_posts_select
  on public.hub_posts
  for select
  to authenticated
  using ((select private.is_approved((select auth.uid()))));

drop policy if exists hub_posts_insert on public.hub_posts;
create policy hub_posts_insert
  on public.hub_posts
  for insert
  to authenticated
  with check (
    (select private.is_approved((select auth.uid())))
    and author_id = (select auth.uid())
  );

drop policy if exists hub_posts_update on public.hub_posts;
create policy hub_posts_update
  on public.hub_posts
  for update
  to authenticated
  using (
    (select private.is_approved((select auth.uid())))
    and author_id = (select auth.uid())
  )
  with check (
    (select private.is_approved((select auth.uid())))
    and author_id = (select auth.uid())
  );

drop policy if exists hub_posts_delete on public.hub_posts;
create policy hub_posts_delete
  on public.hub_posts
  for delete
  to authenticated
  using (
    (select private.is_approved((select auth.uid())))
    and (
      author_id = (select auth.uid())
      or (select private.is_admin())
    )
  );

drop policy if exists hub_replies_select on public.hub_replies;
create policy hub_replies_select
  on public.hub_replies
  for select
  to authenticated
  using ((select private.is_approved((select auth.uid()))));

drop policy if exists hub_replies_insert on public.hub_replies;
create policy hub_replies_insert
  on public.hub_replies
  for insert
  to authenticated
  with check (
    (select private.is_approved((select auth.uid())))
    and author_id = (select auth.uid())
  );

drop policy if exists hub_replies_update on public.hub_replies;
create policy hub_replies_update
  on public.hub_replies
  for update
  to authenticated
  using (
    (select private.is_approved((select auth.uid())))
    and author_id = (select auth.uid())
  )
  with check (
    (select private.is_approved((select auth.uid())))
    and author_id = (select auth.uid())
  );

drop policy if exists hub_replies_delete on public.hub_replies;
create policy hub_replies_delete
  on public.hub_replies
  for delete
  to authenticated
  using (
    (select private.is_approved((select auth.uid())))
    and (
      author_id = (select auth.uid())
      or (select private.is_admin())
    )
  );

drop policy if exists hub_reports_select on public.hub_reports;
create policy hub_reports_select
  on public.hub_reports
  for select
  to authenticated
  using ((select private.is_admin()));

drop policy if exists hub_reports_insert on public.hub_reports;
create policy hub_reports_insert
  on public.hub_reports
  for insert
  to authenticated
  with check (
    (select private.is_approved((select auth.uid())))
    and reporter_id = (select auth.uid())
  );

drop policy if exists hub_reports_update on public.hub_reports;
create policy hub_reports_update
  on public.hub_reports
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists hub_reports_delete on public.hub_reports;
create policy hub_reports_delete
  on public.hub_reports
  for delete
  to authenticated
  using (
    (select private.is_approved((select auth.uid())))
    and (
      (select private.is_admin())
      or not exists (select 1 from public.hub_posts p where p.id = post_id)
      or (
        reply_id is not null
        and not exists (select 1 from public.hub_replies y where y.id = reply_id)
      )
      or exists (
        select 1 from public.hub_posts p
        where p.id = post_id and p.author_id = (select auth.uid())
      )
      or exists (
        select 1 from public.hub_replies y
        where y.id = reply_id and y.author_id = (select auth.uid())
      )
    )
  );

create or replace view public.hub_feed
with (security_barrier = true, security_invoker = false) as
select
  p.id,
  p.title,
  p.body,
  p.created_at,
  p.updated_at,
  p.activity_at,
  coalesce(a.author_name, 'Member') as author_name,
  coalesce(a.author_role, 'Member') as author_role,
  coalesce(a.author_verified, false) as author_verified,
  (select count(*)::int from public.hub_replies r where r.post_id = p.id) as reply_count,
  exists (
    select 1 from public.hub_reports rep
    where rep.reporter_id = (select auth.uid())
      and rep.post_id = p.id
      and rep.reply_id is null
      and rep.status = 'open'
  ) as reported,
  p.author_id = (select auth.uid()) as mine
from public.hub_posts p
left join lateral (
  select
    j->>'name' as author_name,
    j->>'role' as author_role,
    coalesce((j->>'verified')::boolean, false) as author_verified
  from (select private.hub_author(p.author_id) as j) s
) a on true
where (select private.is_approved((select auth.uid())));

create or replace view public.hub_reply_feed
with (security_barrier = true, security_invoker = false) as
select
  r.id,
  r.post_id,
  r.body,
  r.created_at,
  r.updated_at,
  coalesce(a.author_name, 'Member') as author_name,
  coalesce(a.author_role, 'Member') as author_role,
  coalesce(a.author_verified, false) as author_verified,
  exists (
    select 1 from public.hub_reports rep
    where rep.reporter_id = (select auth.uid())
      and rep.reply_id = r.id
      and rep.status = 'open'
  ) as reported,
  r.author_id = (select auth.uid()) as mine
from public.hub_replies r
left join lateral (
  select
    j->>'name' as author_name,
    j->>'role' as author_role,
    coalesce((j->>'verified')::boolean, false) as author_verified
  from (select private.hub_author(r.author_id) as j) s
) a on true
where (select private.is_approved((select auth.uid())));

create or replace view public.hub_report_queue
with (security_barrier = true, security_invoker = false) as
select
  r.id,
  r.post_id,
  r.reply_id,
  case when r.reply_id is null then 'post' else 'reply' end as kind,
  r.created_at,
  p.title,
  case when r.reply_id is null then p.body else y.body end as body,
  coalesce(a.author_name, 'Member') as author_name,
  coalesce(a.author_role, 'Member') as author_role,
  coalesce(a.author_verified, false) as author_verified,
  coalesce(w.reporter_name, 'Member') as reporter_name
from public.hub_reports r
join public.hub_posts p on p.id = r.post_id
left join public.hub_replies y on y.id = r.reply_id
left join lateral (
  select
    j->>'name' as author_name,
    j->>'role' as author_role,
    coalesce((j->>'verified')::boolean, false) as author_verified
  from (
    select private.hub_author(case when r.reply_id is null then p.author_id else y.author_id end) as j
  ) s
) a on true
left join lateral (
  select j->>'name' as reporter_name
  from (select private.hub_author(r.reporter_id) as j) s
) w on true
where r.status = 'open'
  and (select private.is_admin())
  and (r.reply_id is null or y.id is not null);

revoke all on table public.hub_feed from public, anon, authenticated;
revoke all on table public.hub_reply_feed from public, anon, authenticated;
revoke all on table public.hub_report_queue from public, anon, authenticated;
grant select on table public.hub_feed to authenticated;
grant select on table public.hub_reply_feed to authenticated;
grant select on table public.hub_report_queue to authenticated;
