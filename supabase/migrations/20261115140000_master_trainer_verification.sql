-- Master Trainer certification review.
-- Apply once in the Supabase SQL editor AFTER 20261115002700_profile_details.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
--
-- What it adds:
--   public.admins
--     One row, the email kinisiathletics@gmail.com. No API access. The
--     private.is_admin() function reads it (and auth.users) as the function
--     owner. A signed-in person cannot insert themselves.
--   public.profiles.verified_until
--     The certification expiration date. A signed-in person cannot set it.
--     Only the review trigger sets it, and only when an admin approves.
--     The database owner (auth.uid() is null, as in the SQL editor) can
--     still correct a row. The seal is shown only while this date is today
--     or later. The day after it, the seal is gone and the trainer can
--     submit again. Nothing deletes the old row to make that happen.
--   public.verification_requests
--     One row per submission: user id, certifying organization, certification
--     number, expires_on, status (pending, approved, declined), admin note,
--     created_at, reviewed_at. The owner can insert and read their own rows.
--     They cannot update them. A second pending row is rejected. A request
--     is rejected when the person is not a Master Trainer, the date is not
--     in the future, or they are already verified. Other people cannot read
--     the row. The admin can read every row and can set status and the note.
--     Decline with an empty note is rejected. Approve writes verified_until.
--   public.verification_queue
--     Pending rows plus the trainer name and email, for the admin page.
--     The view is empty unless private.is_admin() is true. It does not grant
--     access to the rest of profiles.
--   public.trainer_verified
--     Any signed-in person can read which Master Trainers are currently
--     verified (id and true). It does not include the certification number,
--     the note, or the email. A trainer whose date has passed is absent.
--   Name payloads that already show a person to someone else
--     (profile_card, message threads, the linked trainer, a sent workout)
--     gain a verified flag computed from verified_until. linked_profile_cards
--     and the not-yet-granted trainer_directory gain the same flag.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create table if not exists public.admins (
  email text primary key,
  constraint admins_email_check check (email = lower(email) and position('@' in email) > 1)
);

insert into public.admins (email) values ('kinisiathletics@gmail.com')
on conflict (email) do nothing;

alter table public.admins enable row level security;
revoke all on table public.admins from public, anon, authenticated;

-- Reads auth.users, which a signed-in role cannot select. The email claim in
-- the JWT is not used: that claim can be stale, and user_metadata is not safe.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and exists (
        select 1 from public.admins a
        where a.email = lower(u.email)
      )
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

alter table public.profiles
  add column if not exists verified_until date;

-- Signed-in updates cannot change the column. The review trigger sets a
-- transaction flag before it writes the approved expiration date.
create or replace function private.lock_verified_until()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.verified_until := null;
    end if;
    return new;
  end if;
  if auth.uid() is not null
     and current_setting('app.verification_review', true) is distinct from 'on' then
    new.verified_until := old.verified_until;
  end if;
  return new;
end;
$$;

revoke all on function private.lock_verified_until() from public, anon, authenticated;
grant execute on function private.lock_verified_until() to authenticated;

drop trigger if exists profiles_lock_verified on public.profiles;
create trigger profiles_lock_verified
  before insert or update on public.profiles
  for each row execute function private.lock_verified_until();

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  cert_body text not null,
  cert_number text not null,
  expires_on date not null,
  status text not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint verification_requests_status_check check (status in ('pending', 'approved', 'declined')),
  constraint verification_requests_body_len check (char_length(cert_body) between 1 and 120),
  constraint verification_requests_number_len check (char_length(cert_number) between 1 and 80),
  constraint verification_requests_note_len check (admin_note is null or char_length(admin_note) between 1 and 280)
);

create index if not exists verification_requests_user_created
  on public.verification_requests (user_id, created_at desc);

create unique index if not exists verification_requests_one_pending
  on public.verification_requests (user_id)
  where status = 'pending';

alter table public.verification_requests enable row level security;
revoke all on table public.verification_requests from public, anon, authenticated;
grant select, insert, update on table public.verification_requests to authenticated;

create or replace function private.verification_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership text;
  until date;
begin
  if (select auth.uid()) is null or new.user_id is distinct from (select auth.uid()) then
    raise exception 'Sign in first.';
  end if;
  select p.membership, p.verified_until into membership, until
  from public.profiles p
  where p.id = new.user_id;
  if membership is distinct from 'master_trainer' then
    raise exception 'Only a Master Trainer can request verification.';
  end if;
  if until is not null and until >= current_date then
    raise exception 'You are already verified.';
  end if;
  new.cert_body := nullif(btrim(new.cert_body), '');
  new.cert_number := nullif(btrim(new.cert_number), '');
  if new.cert_body is null or new.cert_number is null then
    raise exception 'Enter the certifying organization and number.';
  end if;
  if char_length(new.cert_body) > 120 or char_length(new.cert_number) > 80 then
    raise exception 'Certification details are too long.';
  end if;
  if new.expires_on is null or new.expires_on <= current_date then
    raise exception 'Expiration date must be in the future.';
  end if;
  if exists (
    select 1 from public.verification_requests r
    where r.user_id = new.user_id and r.status = 'pending'
  ) then
    raise exception 'A request is already pending review.';
  end if;
  new.status := 'pending';
  new.admin_note := null;
  new.reviewed_at := null;
  new.created_at := now();
  return new;
end;
$$;

create or replace function private.verification_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only the admin can review a verification.';
  end if;
  if old.status is distinct from 'pending' then
    raise exception 'This request was already reviewed.';
  end if;
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.cert_body is distinct from old.cert_body
     or new.cert_number is distinct from old.cert_number
     or new.expires_on is distinct from old.expires_on
     or new.created_at is distinct from old.created_at then
    raise exception 'Request details cannot change.';
  end if;
  if new.status = 'approved' then
    new.admin_note := null;
    new.reviewed_at := now();
    perform set_config('app.verification_review', 'on', true);
    update public.profiles
      set verified_until = new.expires_on
      where id = new.user_id;
  elsif new.status = 'declined' then
    new.admin_note := nullif(btrim(new.admin_note), '');
    if new.admin_note is null then
      raise exception 'Enter a note.';
    end if;
    if char_length(new.admin_note) > 280 then
      raise exception 'Keep the note short.';
    end if;
    new.reviewed_at := now();
  else
    raise exception 'Choose approve or decline.';
  end if;
  return new;
end;
$$;

revoke all on function private.verification_guard_insert() from public, anon, authenticated;
revoke all on function private.verification_guard_update() from public, anon, authenticated;
grant execute on function private.verification_guard_insert() to authenticated;
grant execute on function private.verification_guard_update() to authenticated;

drop trigger if exists verification_requests_guard_insert on public.verification_requests;
create trigger verification_requests_guard_insert
  before insert on public.verification_requests
  for each row execute function private.verification_guard_insert();

drop trigger if exists verification_requests_guard_update on public.verification_requests;
create trigger verification_requests_guard_update
  before update on public.verification_requests
  for each row execute function private.verification_guard_update();

drop policy if exists verification_requests_select on public.verification_requests;
create policy verification_requests_select
  on public.verification_requests
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

drop policy if exists verification_requests_insert_own on public.verification_requests;
create policy verification_requests_insert_own
  on public.verification_requests
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and admin_note is null
    and reviewed_at is null
  );

drop policy if exists verification_requests_update_admin on public.verification_requests;
create policy verification_requests_update_admin
  on public.verification_requests
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- security_invoker stays off so a signed-in person can see the flag even
-- though profiles itself only lets them select their own row. The select list
-- is the only thing they receive. security_barrier keeps a caller's filter
-- from running before that list is built.
create or replace view public.trainer_verified
with (security_barrier = true, security_invoker = false) as
select
  p.id,
  true as verified
from public.profiles p
where p.membership = 'master_trainer'
  and p.verified_until is not null
  and p.verified_until >= current_date;

revoke all on table public.trainer_verified from public, anon, authenticated;
grant select on table public.trainer_verified to authenticated;

create or replace view public.verification_queue
with (security_barrier = true, security_invoker = false) as
select
  r.id,
  r.user_id,
  nullif(btrim(p.display_name), '') as display_name,
  p.email,
  r.cert_body,
  r.cert_number,
  r.expires_on,
  r.created_at
from public.verification_requests r
join public.profiles p on p.id = r.user_id
where r.status = 'pending'
  and private.is_admin();

revoke all on table public.verification_queue from public, anon, authenticated;
grant select on table public.verification_queue to authenticated;

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
where public.profile_is_linked(p.id);

revoke all on table public.linked_profile_cards from public, anon, authenticated;
grant select on table public.linked_profile_cards to authenticated;

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
  and nullif(btrim(p.display_name), '') is not null;

revoke all on table public.trainer_directory from public, anon, authenticated;

create or replace function public.profile_card(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row public.profiles;
begin
  if p_id is null or not public.profile_is_linked(p_id) then
    return null;
  end if;
  select * into row from public.profiles where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', row.id,
    'name', nullif(btrim(row.display_name), ''),
    'avatarPath', row.avatar_path,
    'verified', coalesce(
      row.membership = 'master_trainer'
      and row.verified_until is not null
      and row.verified_until >= current_date,
      false
    )
  );
end;
$$;

create or replace function public.invite_mine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  link public.trainer_clients;
  trainer public.profiles;
begin
  if uid is null then return 'null'::jsonb; end if;
  select * into link from public.trainer_clients
    where client_id = uid and ended_at is null limit 1;
  if not found then return 'null'::jsonb; end if;
  select * into trainer from public.profiles where id = link.trainer_id;
  return jsonb_build_object(
    'trainerId', link.trainer_id,
    'trainerEmail', trainer.email,
    'trainerName', nullif(btrim(trainer.display_name), ''),
    'avatarPath', trainer.avatar_path,
    'verified', coalesce(
      trainer.membership = 'master_trainer'
      and trainer.verified_until is not null
      and trainer.verified_until >= current_date,
      false
    )
  );
end;
$$;

create or replace function public.message_threads()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  role text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  role := case
    when me.membership in ('trainer', 'master_trainer')
      or me.intended_plan in ('trainer', 'master_trainer')
    then 'trainer'
    else 'client'
  end;
  return jsonb_build_object(
    'role', role,
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.person_id,
        'name', r.email,
        'plan', r.plan,
        'avatarPath', public.profile_card(r.person_id)->>'avatarPath',
        'verified', coalesce((public.profile_card(r.person_id)->>'verified')::boolean, false),
        'preview', lm.body,
        'at', lm.created_at,
        'unread', (
          select count(*)::int from public.messages m
          where m.trainer_id = r.trainer_id
            and m.client_id = r.client_id
            and m.sender_id <> uid
            and m.read_at is null
        )
      ) order by lm.created_at desc nulls last, r.email)
      from public.message_roster() r
      left join lateral (
        select body, created_at
        from public.messages
        where trainer_id = r.trainer_id and client_id = r.client_id
        order by created_at desc, id desc
        limit 1
      ) lm on true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.message_open(p_person uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pair record;
  person jsonb;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into pair from public.message_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  select jsonb_build_object(
    'id', r.person_id,
    'name', r.email,
    'plan', r.plan,
    'avatarPath', public.profile_card(r.person_id)->>'avatarPath',
    'verified', coalesce((public.profile_card(r.person_id)->>'verified')::boolean, false)
  )
    into person
  from public.message_roster() r
  where r.person_id = p_person
  limit 1;
  return jsonb_build_object(
    'person', person,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'senderId', m.sender_id,
        'mine', m.sender_id = uid,
        'body', m.body,
        'at', m.created_at,
        'readAt', m.read_at
      ) order by m.created_at, m.id)
      from (
        select *
        from public.messages
        where trainer_id = pair.trainer and client_id = pair.client
        order by created_at desc, id desc
        limit 200
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.workout_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id,
      'name', w.name,
      'items', w.items,
      'sourceTrainerId', w.trainer_id,
      'sourceTrainerEmail', coalesce(p.email, 'your trainer'),
      'sourceTrainerName', nullif(btrim(p.display_name), ''),
      'sourceTrainerVerified', coalesce(
        p.membership = 'master_trainer'
        and p.verified_until is not null
        and p.verified_until >= current_date,
        false
      ),
      'sourceWorkoutId', w.source_workout_id,
      'createdAt', w.created_at,
      'updatedAt', w.updated_at
    ) order by w.created_at desc)
    from public.workout_copies w
    left join public.profiles p on p.id = w.trainer_id
    where w.owner_id = uid
      and public.workout_linked(w.trainer_id, uid)
  ), '[]'::jsonb);
end;
$$;
