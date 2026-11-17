-- Invite-only access, plus the security fixes from the read-only audit.
-- Apply once in the Supabase SQL editor AFTER 20261117120000_dashboard_holds_stopwatch.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Safe to run again. Running it twice does not approve people who were
-- turned away after the first run, and it does not change who can pick a
-- plan or how membership is granted. Paid membership stays with the later
-- Stripe work. Do not deploy an Edge Function for this file. The calendar
-- feed function keeps the same call and does not need a redeploy.
--
-- What a person can do before an admin approves them:
--   They can read and update their own basic profile (name, photo, city,
--   state, bio). They cannot change the approval flag or their stored email.
--   They cannot use workouts, programs, invites, messages, tracking, shares,
--   the calendar, saved account workouts, or verification submit.
-- The admin (a row in public.admins, read from auth.users) is always approved.
-- Accounts that already exist the first time this file runs are approved,
-- so people using the app today are not locked out.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists access_approved boolean not null default false;

comment on column public.profiles.access_approved is
  'True when an admin has approved this account. The admin is approved even when this is false. New accounts start false. Existing accounts were set true once, the first time the invite-only migration ran.';

-- One helper for policies and functions. Null is not approved.
-- An email in public.admins is approved even if the flag is off.
create or replace function private.is_approved(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    uid is not null
    and (
      exists (
        select 1
        from auth.users u
        join public.admins a on a.email = lower(u.email)
        where u.id = uid
      )
      or exists (
        select 1
        from public.profiles p
        where p.id = uid
          and p.access_approved
      )
    ),
    false
  );
$fn$;

-- Remember that the one-time backfill has run. A later run must not
-- turn access back on for someone an admin has removed.
create table if not exists private.access_backfill (
  done boolean primary key default true,
  done_at timestamptz not null default now(),
  constraint access_backfill_one check (done)
);

revoke all on table private.access_backfill from public, anon, authenticated;

do $backfill$
begin
  if not exists (select 1 from private.access_backfill) then
    update public.profiles set access_approved = true;
    insert into private.access_backfill (done) values (true);
  end if;
end
$backfill$;

-- A signed-in person cannot approve themselves on the row they create.
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if auth.uid() is not null then
    if new.id is distinct from auth.uid() then
      raise exception 'cannot create a profile for someone else';
    end if;
    if new.membership is distinct from 'none' then
      raise exception 'new accounts do not start with a membership';
    end if;
    new.access_approved := false;
  end if;
  return new;
end;
$fn$;

-- Same profile rules as 20261115002700_profile_details.sql.
-- A signed-in person cannot change access_approved. Only the admin can.
-- A signed-in person cannot change profiles.email. The value they send is
-- ignored. The admin page reads the email from auth.users instead.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  trainer boolean;
  location_ok boolean;
  profile_fields boolean;
begin
  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
  end if;
  if auth.uid() is not null then
    new.email := old.email;
    if new.access_approved is distinct from old.access_approved
       and not private.is_admin() then
      raise exception 'You cannot change access.';
    end if;
  end if;
  if auth.uid() is not null and new.membership is distinct from old.membership then
    if current_setting('app.invite_redeem', true) is distinct from 'on'
       or old.membership is distinct from 'none'
       or new.membership is distinct from 'free_client' then
      raise exception 'membership changes require an invite or payment';
    end if;
  end if;

  new.display_name := nullif(btrim(new.display_name), '');
  new.city := nullif(btrim(new.city), '');
  new.state := nullif(btrim(new.state), '');
  new.bio := nullif(btrim(new.bio), '');
  if new.online_only is null then
    new.online_only := false;
  end if;
  if new.bio is not null and char_length(new.bio) > 150 then
    raise exception 'Bio can be at most 150 characters.';
  end if;

  if auth.uid() is not null
     and nullif(btrim(coalesce(old.display_name, '')), '') is not null
     and new.display_name is null then
    raise exception 'Enter your name.';
  end if;

  trainer := new.membership in ('trainer', 'master_trainer')
    or (
      coalesce(new.membership, '') not in ('free_client', 'enthusiast')
      and new.intended_plan in ('trainer', 'master_trainer')
    );
  location_ok := coalesce(new.online_only, false)
    or (new.city is not null and new.state is not null);
  profile_fields := new.display_name is distinct from nullif(btrim(old.display_name), '')
    or new.city is distinct from nullif(btrim(old.city), '')
    or new.state is distinct from nullif(btrim(old.state), '')
    or new.online_only is distinct from coalesce(old.online_only, false)
    or new.bio is distinct from nullif(btrim(old.bio), '')
    or new.avatar_path is distinct from old.avatar_path;

  if auth.uid() is not null
     and new.display_name is not null
     and trainer
     and not location_ok
     and profile_fields then
    raise exception 'Enter a city and state, or choose Online only.';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

-- Names and emails for the admin Access section. Empty for everyone else,
-- so one person never sees another person's email outside this admin view.
create or replace view public.access_accounts
with (security_barrier = true, security_invoker = false) as
select
  p.id,
  nullif(btrim(p.display_name), '') as display_name,
  u.email::text as email,
  private.is_approved(p.id) as approved,
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id
where private.is_admin();

revoke all on table public.access_accounts from public, anon, authenticated;
grant select on table public.access_accounts to authenticated;

create or replace function public.access_set(p_user uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not private.is_admin() then
    raise exception 'Only the admin can change access.';
  end if;
  if p_user is null or p_approved is null then
    raise exception 'Choose an account.';
  end if;
  update public.profiles
    set access_approved = p_approved
    where id = p_user;
  if not found then
    raise exception 'That account was not found.';
  end if;
end;
$fn$;

-- The admin queue shows the sign-in email from auth.users, not profiles.email.
-- auth.users.email is varchar(255). The live view's email column is text,
-- so the cast keeps that type. Replacing a view cannot change a column's type.
create or replace view public.verification_queue
with (security_barrier = true, security_invoker = false) as
select
  r.id,
  r.user_id,
  nullif(btrim(p.display_name), '') as display_name,
  u.email::text as email,
  r.cert_body,
  r.cert_number,
  r.expires_on,
  r.created_at
from public.verification_requests r
join public.profiles p on p.id = r.user_id
join auth.users u on u.id = r.user_id
where r.status = 'pending'
  and private.is_admin();

revoke all on table public.verification_queue from public, anon, authenticated;
grant select on table public.verification_queue to authenticated;

-- Linked names, the verified list, and the later trainer directory are
-- app features. An unapproved person gets no rows.
create or replace view public.linked_profile_cards
with (security_barrier = true, security_invoker = false) as
select
  p.id,
  nullif(btrim(p.display_name), '') as display_name,
  p.avatar_path,
  (
    p.membership = 'master_trainer'
    and p.verified_until is not null
    and p.verified_until >= current_date
  ) as verified
from public.profiles p
where public.profile_is_linked(p.id)
  and private.is_approved((select auth.uid()));

revoke all on table public.linked_profile_cards from public, anon, authenticated;
grant select on table public.linked_profile_cards to authenticated;

create or replace view public.trainer_verified
with (security_barrier = true, security_invoker = false) as
select
  p.id,
  true as verified
from public.profiles p
where p.membership = 'master_trainer'
  and p.verified_until is not null
  and p.verified_until >= current_date
  and private.is_approved((select auth.uid()));

revoke all on table public.trainer_verified from public, anon, authenticated;
grant select on table public.trainer_verified to authenticated;

create or replace view public.trainer_directory
with (security_barrier = true, security_invoker = false) as
select
  p.id,
  nullif(btrim(p.display_name), '') as display_name,
  nullif(btrim(p.city), '') as city,
  nullif(btrim(p.state), '') as state,
  p.online_only,
  nullif(btrim(p.bio), '') as bio,
  (
    p.verified_until is not null
    and p.verified_until >= current_date
  ) as verified
from public.profiles p
where p.membership in ('trainer', 'master_trainer')
  and nullif(btrim(p.display_name), '') is not null
  and private.is_approved((select auth.uid()));

revoke all on table public.trainer_directory from public, anon, authenticated;

-- Saved account workouts. The caller must be approved and must already have
-- a real membership: free client, enthusiast, trainer, or master trainer.
-- A plan they only selected (intended_plan) is not enough. Enthusiast stays
-- at 6 workouts. Importing old workouts uses that same ceiling. It cannot
-- raise the limit to 40. Trainer, Master Trainer, and Free Client keep the
-- caps they already had (no numeric cap on these rows).
create or replace function public.account_workouts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int;
  caller_entitled boolean;
  owner_capped boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    if new.revised_at is null then new.revised_at := now(); end if;
    new.updated_at := now();
    return new;
  end if;

  if not private.is_approved((select auth.uid())) then
    raise exception 'Your account is waiting for approval.';
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.membership in ('free_client', 'enthusiast', 'trainer', 'master_trainer')
  ) into caller_entitled;

  if tg_op = 'DELETE' then
    if not public.account_can_write(old.owner_id) then
      raise exception 'You cannot delete that workout.';
    end if;
    return old;
  end if;

  if not caller_entitled then
    raise exception 'Could not save that workout.';
  end if;

  if tg_op = 'INSERT' then
    if not public.account_can_write(new.owner_id) then
      raise exception 'You cannot save that workout.';
    end if;
  elsif tg_op = 'UPDATE' then
    if not public.account_can_write(old.owner_id) or not public.account_can_write(new.owner_id) then
      raise exception 'You cannot edit that workout.';
    end if;
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.local_id is distinct from old.local_id
       or new.created_at is distinct from old.created_at then
      raise exception 'That workout cannot be reassigned.';
    end if;
  else
    return null;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = new.owner_id
      and p.membership = 'enthusiast'
  ) into owner_capped;

  if owner_capped
     and new.deleted_at is null
     and (tg_op = 'INSERT' or old.deleted_at is not null) then
    select count(*) into n from public.account_workouts
      where owner_id = new.owner_id and deleted_at is null;
    if n >= 6 then
      raise exception 'Your plan includes up to 6 workouts.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.revised_at is null then new.revised_at := now(); end if;
  else
    if new.revised_at is null then new.revised_at := old.revised_at; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

-- Calendar tokens are created here. A token sent by the browser is ignored.
-- A normal save keeps the current token. A reset (the app sets a flag for
-- this statement only) replaces it with a new random token.
create or replace function public.calendar_feeds_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  if auth.uid() is not null and not private.is_approved((select auth.uid())) then
    raise exception 'Your account is waiting for approval.';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.user_id is distinct from auth.uid() then
      raise exception 'You cannot create a calendar link for someone else.';
    end if;
    new.token := encode(gen_random_bytes(32), 'hex');
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'That calendar link cannot be reassigned.';
    end if;
    if auth.uid() is not null and old.user_id is distinct from auth.uid() then
      raise exception 'You cannot change someone else''s calendar link.';
    end if;
    if current_setting('app.calendar_rotate', true) = 'on' then
      new.token := encode(gen_random_bytes(32), 'hex');
    else
      new.token := old.token;
    end if;
    new.updated_at := now();
    return new;
  end if;

  return new;
end;
$fn$;

create or replace function public.calendar_feed_save(p_zone text, p_reset boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  uid uuid := (select auth.uid());
  zone text := btrim(coalesce(p_zone, ''));
  row public.calendar_feeds;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  if zone !~ '^[A-Za-z0-9_+-]{1,64}(/[A-Za-z0-9_+-]{1,64}){0,3}$' then
    zone := 'UTC';
  end if;
  if coalesce(p_reset, false) then
    perform set_config('app.calendar_rotate', 'on', true);
  end if;
  insert into public.calendar_feeds (user_id, token, time_zone)
  values (uid, encode(gen_random_bytes(32), 'hex'), zone)
  on conflict (user_id) do update
    set time_zone = excluded.time_zone
  returning * into row;
  return jsonb_build_object('token', row.token, 'time_zone', row.time_zone);
end;
$fn$;

-- The public feed stays callable only by the service role. An unapproved
-- owner's link returns nothing, so the existing Edge Function shows its
-- usual not-found page. That function does not need a redeploy.
create or replace function public.calendar_feed_for_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  feed public.calendar_feeds;
  v_user uuid;
  v_zone text;
  v_trainer boolean;
  events jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into feed
  from public.calendar_feeds
  where token = p_token;

  if not found then
    return null;
  end if;

  v_user := feed.user_id;
  v_zone := feed.time_zone;
  if not private.is_approved(v_user) then
    return null;
  end if;
  v_trainer := public.program_is_trainer(v_user);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'day', s.day,
      'start', s.start_at,
      'end', s.end_at,
      'updated', s.updated
    )
    order by s.day, s.start_at nulls last, s.id
  ), '[]'::jsonb)
  into events
  from (
    select
      e.id::text as id,
      e.workout_name as title,
      to_char(e.day, 'YYYY-MM-DD') as day,
      to_char(e.starts_at, 'HH24:MI') as start_at,
      to_char(e.ends_at, 'HH24:MI') as end_at,
      to_char(e.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated
    from public.program_entries e
    where e.owner_id = v_user

    union all

    select
      e.id::text,
      e.workout_name || ' ' || chr(8211) || ' ' || private.shown_name(
        c.display_name,
        case
          when c.membership = 'enthusiast' or c.intended_plan = 'enthusiast' then 'Enthusiast'
          else 'Client'
        end
      ),
      to_char(e.day, 'YYYY-MM-DD'),
      to_char(e.starts_at, 'HH24:MI'),
      to_char(e.ends_at, 'HH24:MI'),
      to_char(e.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    from public.program_entries e
    join public.profiles c on c.id = e.owner_id
    where v_trainer
      and e.owner_id <> v_user
      and e.presence = 'trainer'
      and public.program_linked(v_user, e.owner_id)
      and (
        not public.share_is_enthusiast(e.owner_id)
        or coalesce(c.share_with_trainer, false)
      )
  ) s;

  return jsonb_build_object(
    'timezone', v_zone,
    'events', events
  );
end;
$fn$;

-- Invite codes come from gen_random_bytes. The alphabet and
-- the 8-character shape stay the same, so codes already shared still work.
create or replace function public.invite_make_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $fn$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  out text := '';
  i int;
  n int := length(alphabet);
begin
  for i in 0..7 loop
    out := out || substr(alphabet, 1 + (get_byte(bytes, i) % n), 1);
  end loop;
  return out;
end;
$fn$;

-- A bad, used, canceled, expired, or full invite all return the same
-- sentence, so the message does not reveal which of those it was.
-- Signing in, being a trainer, and already having a trainer stay specific,
-- because those are about the signed-in person, not about the code.
create or replace function public.invite_redeem(p_code text, p_share boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  me public.profiles;
  inv public.invites;
  trainer public.profiles;
  norm text;
  existing uuid;
  active_clients int;
  cap int;
  enthusiast boolean;
  generic text := 'That invite could not be used.';
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  if public.invite_role(me) is not null then
    raise exception 'A Trainer or Master Trainer cannot join as a client.';
  end if;
  select id into existing from public.trainer_clients
    where client_id = uid and ended_at is null limit 1;
  if existing is not null then
    raise exception 'You are already connected to a trainer. End that connection before using a new invite.';
  end if;
  norm := public.invite_norm(p_code);
  if norm !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception '%', generic;
  end if;
  select * into inv from public.invites where code = norm for update;
  if not found
     or inv.used_at is not null
     or inv.canceled_at is not null
     or inv.expires_at <= now() then
    raise exception '%', generic;
  end if;
  perform pg_advisory_xact_lock(hashtext(inv.trainer_id::text));
  select * into trainer from public.profiles where id = inv.trainer_id;
  cap := public.invite_cap(public.invite_role(trainer));
  select count(*) into active_clients from public.trainer_clients
    where trainer_id = inv.trainer_id and ended_at is null;
  if active_clients >= cap then
    raise exception '%', generic;
  end if;
  enthusiast := coalesce(me.membership, '') = 'enthusiast'
    or coalesce(me.intended_plan, '') = 'enthusiast';
  if not enthusiast and me.membership is distinct from 'free_client' then
    perform set_config('app.invite_redeem', 'on', true);
    update public.profiles set membership = 'free_client' where id = uid;
  end if;
  if enthusiast then
    update public.profiles
      set share_with_trainer = case when p_share is null then true else p_share end
      where id = uid;
  end if;
  update public.invites set used_at = now(), used_by = uid where id = inv.id;
  insert into public.trainer_clients (trainer_id, client_id) values (inv.trainer_id, uid);
  if enthusiast then
    return jsonb_build_object(
      'message', 'You are connected. Your Enthusiast plan is unchanged.',
      'trainer_id', inv.trainer_id
    );
  end if;
  return jsonb_build_object(
    'message', 'You are connected as a Free Client.',
    'trainer_id', inv.trainer_id
  );
end;
$fn$;

-- Message names go through this security-definer list. Hide it until approved.
create or replace function public.message_roster()
returns table (
  person_id uuid,
  name text,
  plan text,
  trainer_id uuid,
  client_id uuid
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    case when c.trainer_id = auth.uid() then c.client_id else c.trainer_id end,
    private.shown_name(
      p.display_name,
      case
        when c.trainer_id = auth.uid()
         and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
        when c.trainer_id = auth.uid() then 'Client'
        else 'Trainer'
      end
    ),
    case
      when c.trainer_id = auth.uid()
        and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
      when c.trainer_id = auth.uid() then 'Free Client'
      else 'Trainer'
    end,
    c.trainer_id,
    c.client_id
  from public.trainer_clients c
  join public.profiles p
    on p.id = case when c.trainer_id = auth.uid() then c.client_id else c.trainer_id end
  where private.is_approved((select auth.uid()))
    and c.ended_at is null
    and auth.uid() is not null
    and (c.trainer_id = auth.uid() or c.client_id = auth.uid());
$fn$;

-- Exercise search and filter labels are app features. An unapproved person
-- gets no rows and an empty filter list. The table policy below does the
-- same for a direct read.
do $search$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_exercises'
  order by p.oid
  limit 1;
  if def is null then
    raise exception 'search_exercises is missing';
  end if;
  if position('private.is_approved' in def) = 0 then
    def := replace(
      def,
      '(select auth.uid()) is not null',
      'private.is_approved((select auth.uid()))'
    );
    if position('private.is_approved' in def) = 0 then
      raise exception 'could not add approval to search_exercises';
    end if;
    execute def;
  end if;

  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'exercise_filter_options'
  order by p.oid
  limit 1;
  if def is null then
    raise exception 'exercise_filter_options is missing';
  end if;
  if position('private.is_approved' in def) = 0 then
    def := replace(
      def,
      '(select auth.uid()) is null',
      'not private.is_approved((select auth.uid()))'
    );
    if position('private.is_approved' in def) = 0 then
      raise exception 'could not add approval to exercise_filter_options';
    end if;
    execute def;
  end if;
end
$search$;

revoke all on function public.search_exercises(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_exercises(text, text, text, text, integer, integer) to authenticated;
revoke all on function public.exercise_filter_options() from public, anon;
grant execute on function public.exercise_filter_options() to authenticated;

-- Every app policy except a person's own profile row must call is_approved.
-- Own profile select, insert, and update stay open so a waiting person can
-- still read and edit the basic profile. Running this again leaves a policy
-- alone once it already calls the helper.
do $policies$
declare
  r record;
  cmd text;
  roles text;
  qual text;
  chk text;
  sql text;
begin
  create temp table _wb_policies on commit drop as
  select
    n.nspname as schema_name,
    c.relname as table_name,
    p.polname as policy_name,
    p.polcmd as cmd_code,
    p.polpermissive as permissive,
    p.polroles as role_ids,
    pg_get_expr(p.polqual, p.polrelid) as qual,
    pg_get_expr(p.polwithcheck, p.polrelid) as chk
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname <> 'profiles';

  for r in select * from _wb_policies loop
    if coalesce(r.qual, '') like '%private.is_approved%'
       and (r.chk is null or r.chk like '%private.is_approved%') then
      continue;
    end if;
    if r.chk is not null
       and coalesce(r.qual, '') like '%private.is_approved%'
       and r.chk like '%private.is_approved%' then
      continue;
    end if;
    if coalesce(r.qual, '') like '%private.is_approved%' and r.chk is null then
      continue;
    end if;

    cmd := case r.cmd_code
      when 'r' then 'select'
      when 'a' then 'insert'
      when 'w' then 'update'
      when 'd' then 'delete'
      else 'all'
    end;

    if r.role_ids is null or cardinality(r.role_ids) = 0 then
      roles := 'public';
    else
      select string_agg(quote_ident(g.rolname), ', ' order by g.rolname)
        into roles
      from pg_roles g
      where g.oid = any (r.role_ids);
    end if;

    qual := r.qual;
    chk := r.chk;
    if qual is not null and qual not like '%private.is_approved%' then
      qual := '(' || qual || ') and private.is_approved((select auth.uid()))';
    end if;
    if chk is not null and chk not like '%private.is_approved%' then
      chk := '(' || chk || ') and private.is_approved((select auth.uid()))';
    end if;

    execute format('drop policy %I on %I.%I', r.policy_name, r.schema_name, r.table_name);
    sql := 'create policy ' || quote_ident(r.policy_name)
      || ' on ' || quote_ident(r.schema_name) || '.' || quote_ident(r.table_name)
      || ' as ' || case when r.permissive then 'permissive' else 'restrictive' end
      || ' for ' || cmd
      || ' to ' || roles;
    if qual is not null then
      sql := sql || ' using (' || qual || ')';
    end if;
    if chk is not null then
      sql := sql || ' with check (' || chk || ')';
    end if;
    execute sql;
  end loop;
end
$policies$;

-- Own avatar upload stays part of the basic profile. Seeing someone else's
-- photo is an app feature and needs approval. Skipped when Storage is absent.
do $avatars$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  execute 'drop policy if exists avatars_select on storage.objects';
  execute 'drop policy if exists avatars_insert_own on storage.objects';
  execute 'drop policy if exists avatars_update_own on storage.objects';
  execute $pol$
    create policy avatars_select
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'avatars'
      and (
        public.profile_owns_avatar(name)
        or (
          private.is_approved((select auth.uid()))
          and public.profile_can_read_avatar(name)
        )
      )
    )
  $pol$;
  execute $pol$
    create policy avatars_insert_own
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'avatars'
      and public.profile_owns_avatar(name)
    )
  $pol$;
  execute $pol$
    create policy avatars_update_own
    on storage.objects
    for update
    to authenticated
    using (
      bucket_id = 'avatars'
      and public.profile_owns_avatar(name)
    )
    with check (
      bucket_id = 'avatars'
      and public.profile_owns_avatar(name)
    )
  $pol$;
end
$avatars$;

-- This pull is plain SQL, so the check sits in the query. The table policy
-- also hides the rows. Unapproved callers get an empty list.
create or replace function public.account_workout_pull()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  select coalesce(
    jsonb_agg(public.account_workout_json(w) order by w.created_at),
    '[]'::jsonb
  )
  from public.account_workouts w
  where private.is_approved((select auth.uid()))
    and w.owner_id = (select auth.uid());
$fn$;

-- Add the approval check to the start of each app function a signed-in
-- person can call. Helpers used by the calendar feed are left alone, because
-- that feed runs with no signed-in user. A function that already checks is
-- left as it is, so this block is safe to run again.
create or replace function private.inject_approval_check(fn regprocedure)
returns void
language plpgsql
as $fn$
declare
  def text := pg_get_functiondef(fn);
  lower_def text := lower(def);
  as_at int;
  begin_at int;
  check_sql text := E'\n  if not private.is_approved((select auth.uid())) then\n    raise exception ''Your account is waiting for approval.'';\n  end if;\n';
begin
  if position('private.is_approved(' in def) > 0 then
    return;
  end if;
  if position('language plpgsql' in lower_def) = 0 then
    raise exception 'approval check needs plpgsql: %', fn::text;
  end if;
  -- pg_get_functiondef puts "AS $function$" at the start of a line.
  as_at := position('as $' in lower_def);
  if as_at = 0 then
    raise exception 'no function body in %', fn::text;
  end if;
  begin_at := as_at + position('begin' in substr(lower_def, as_at)) - 1;
  if begin_at < as_at then
    raise exception 'no begin in %', fn::text;
  end if;
  def := substr(def, 1, begin_at + 4) || check_sql || substr(def, begin_at + 5);
  execute def;
end;
$fn$;

do $inject$
declare
  fn regprocedure;
  name text;
  names text[] := array[
    'invite_create', 'invite_cancel', 'invite_redeem', 'invite_end',
    'invite_roster', 'invite_mine',
    'message_threads', 'message_open', 'message_send', 'message_read',
    'workout_mine', 'workout_send', 'workout_save', 'workout_delete',
    'workout_sent', 'workout_trainer_save', 'workout_trainer_delete',
    'account_workout_pull', 'account_workout_push', 'account_workout_import',
    'account_client_workouts', 'account_client_save',
    'share_setting', 'share_set', 'share_push', 'share_status',
    'tracking_save_session', 'profile_card'
  ];
  missing text := '';
begin
  foreach name in array names loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = name
    ) then
      missing := missing || ' ' || name;
    end if;
    for fn in
      select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = name
    loop
      perform private.inject_approval_check(fn);
    end loop;
  end loop;
  if missing <> '' then
    raise exception 'missing app function:%', missing;
  end if;
  perform private.inject_approval_check('private.verification_guard_insert()'::regprocedure);
end
$inject$;

do $confirm$
declare
  name text;
  missing text := '';
  names text[] := array[
    'invite_create', 'invite_cancel', 'invite_redeem', 'invite_end',
    'invite_roster', 'invite_mine',
    'message_threads', 'message_open', 'message_send', 'message_read',
    'workout_mine', 'workout_send', 'workout_save', 'workout_delete',
    'workout_sent', 'workout_trainer_save', 'workout_trainer_delete',
    'account_workout_pull', 'account_workout_push', 'account_workout_import',
    'account_client_workouts', 'account_client_save',
    'share_setting', 'share_set', 'share_push', 'share_status',
    'tracking_save_session', 'profile_card', 'message_roster',
    'calendar_feed_save', 'account_workouts_guard'
  ];
begin
  foreach name in array names loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = name
        and pg_get_functiondef(p.oid) like '%private.is_approved(%'
    ) then
      missing := missing || ' ' || name;
    end if;
  end loop;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'verification_guard_insert'
      and pg_get_functiondef(p.oid) like '%private.is_approved(%'
  ) then
    missing := missing || ' verification_guard_insert';
  end if;
  if missing <> '' then
    raise exception 'approval check missing:%', missing;
  end if;
end
$confirm$;

drop function if exists private.inject_approval_check(regprocedure);

-- Anonymous callers cannot run security-definer functions. Signed-in callers
-- can run the app functions. The calendar lookup stays service-role only.
-- The signup trigger stays with the auth admin, not with signed-in people.
do $grants$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon',
      r.nspname, r.proname, r.args
    );
    if r.proname in ('calendar_feed_for_token', 'handle_new_user') then
      execute format(
        'revoke all on function %I.%I(%s) from authenticated',
        r.nspname, r.proname, r.args
      );
      if r.proname = 'calendar_feed_for_token'
         and exists (select 1 from pg_roles where rolname = 'service_role') then
        execute format(
          'grant execute on function %I.%I(%s) to service_role',
          r.nspname, r.proname, r.args
        );
      end if;
      if r.proname = 'handle_new_user'
         and exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
        execute format(
          'grant execute on function %I.%I(%s) to supabase_auth_admin',
          r.nspname, r.proname, r.args
        );
      end if;
    else
      execute format(
        'grant execute on function %I.%I(%s) to authenticated',
        r.nspname, r.proname, r.args
      );
    end if;
  end loop;
end
$grants$;

notify pgrst, 'reload schema';
