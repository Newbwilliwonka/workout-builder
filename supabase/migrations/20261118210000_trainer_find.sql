-- Find a trainer, message requests, and 7-day conversations.
-- Apply once in the Supabase SQL editor AFTER 20261118190000_trainer_hub.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Safe to run again. A second run does not duplicate rows, policies, or indexes.
--
-- What it creates
--   public.profiles.listed
--     False until a Trainer or Master Trainer turns on "Show me in trainer
--     search". Clients, enthusiasts, and a plan that is only chosen
--     (intended_plan) cannot turn it on.
--   public.profiles.service_type
--     in_person, online, or both. Required while listed is true. Search
--     ignores it while listed is false.
--   private.trainer_activity_score(uuid)
--     The only ranking formula. Hub posts in the last 30 days, plus hub
--     replies in the last 30 days, plus the number of active linked clients
--     (trainer_clients with ended_at null, not limited to 30 days). Change
--     this function later without rewriting search.
--   private.public_person(uuid)
--     Name, role, and verified flag. A display name that contains @ is
--     replaced with the role label. It does not return an email.
--   public.trainer_requests
--     id, client_id, trainer_id, note (optional, 1–300), status
--     (open, approved, declined, or closed), created_at, decided_at.
--     closed means a real link code replaced the request. It is not a
--     decline and does not start the 30-day wait.
--   public.trainer_temp_links
--     id, trainer_id, client_id, request_id, created_at, expires_at,
--     ended_at, converted_at. This is not a trainer_clients row. It does
--     not grant workouts, programs, dashboards, the calendar, or the
--     client list. expires_at is 7 days after approval. Ending early sets
--     ended_at. Redeeming that trainer's real link code sets converted_at
--     and the normal permanent link takes over the same messages.
--   public.trainer_search(text, double precision, double precision)
--     Online returns the top 10 listed trainers whose service is online or
--     both, ranked by private.trainer_activity_score. The caller must be an
--     approved client or enthusiast, and does not see a trainer they are
--     already linked to or already in an active temporary conversation with.
--     Near returns no trainers and comingSoon true. p_lat and p_lng are
--     accepted and unused so a later distance rank can use this same
--     function. No email column.
--   public.trainer_request_send(uuid, text)
--   public.trainer_request_decide(uuid, boolean)
--   public.trainer_request_inbox()
--   public.trainer_request_count()
--   public.trainer_temp_end(uuid)
--   public.message_can_send(uuid, uuid)
--     True for an active permanent link, or a temporary link that has not
--     ended, has not been converted, and has not expired.
--   public.message_live(uuid, uuid)
--     Same people can still read after the 7 days. An ended or converted
--     temporary link does not keep the thread open by itself. A converted
--     thread stays open only through the permanent link.
--   Triggers
--     The request limits are checked here, not only in the app:
--       at most 3 open requests per client,
--       no second request to a trainer who declined in the last 30 days,
--       no request when a permanent link or an unexpired temporary link
--       already exists,
--       only a listed Trainer or Master Trainer who offers online or both
--       can be requested.
--     Approving writes the temporary link. Declining records decided_at.
--     Expiry is now() inside message_can_send, so a stale screen cannot
--     keep sending. Either person can set ended_at. Only invite redeem can
--     set converted_at.
--   Policies
--     anon has no access. authenticated can select only their own requests
--     and temporary links, and only when private.is_approved is true.
--     Inserts and updates go through the functions above. A person still
--     cannot read another person's email from these tables.
--   Indexes
--     open requests per client, incoming requests per trainer,
--     declined pairs, one open request per pair,
--     one open temporary link per pair,
--     listed trainers by membership and service type.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.profiles
  add column if not exists listed boolean not null default false,
  add column if not exists service_type text;

comment on column public.profiles.listed is
  'True when this Trainer or Master Trainer has opted in to trainer search. Off by default.';
comment on column public.profiles.service_type is
  'in_person, online, or both. Required while listed is true.';

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_service_type' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_service_type
      check (service_type is null or service_type in ('in_person', 'online', 'both'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_listed_service' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_listed_service
      check (listed = false or service_type is not null);
  end if;
end
$constraints$;

create table if not exists public.trainer_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.trainer_temp_links (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid references public.trainer_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  converted_at timestamptz
);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_requests_status' and conrelid = 'public.trainer_requests'::regclass
  ) then
    alter table public.trainer_requests
      add constraint trainer_requests_status
      check (status in ('open', 'approved', 'declined', 'closed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_requests_note_len' and conrelid = 'public.trainer_requests'::regclass
  ) then
    alter table public.trainer_requests
      add constraint trainer_requests_note_len
      check (note is null or char_length(note) between 1 and 300);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_requests_pair' and conrelid = 'public.trainer_requests'::regclass
  ) then
    alter table public.trainer_requests
      add constraint trainer_requests_pair
      check (client_id <> trainer_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_temp_pair' and conrelid = 'public.trainer_temp_links'::regclass
  ) then
    alter table public.trainer_temp_links
      add constraint trainer_temp_pair
      check (client_id <> trainer_id);
  end if;
end
$constraints$;

create index if not exists trainer_requests_open_client_idx
  on public.trainer_requests (client_id)
  where status = 'open';

create index if not exists trainer_requests_open_trainer_idx
  on public.trainer_requests (trainer_id, created_at)
  where status = 'open';

create index if not exists trainer_requests_declined_idx
  on public.trainer_requests (client_id, trainer_id, decided_at desc)
  where status = 'declined';

create unique index if not exists trainer_requests_one_open
  on public.trainer_requests (client_id, trainer_id)
  where status = 'open';

create index if not exists trainer_temp_open_idx
  on public.trainer_temp_links (trainer_id, client_id)
  where ended_at is null and converted_at is null;

create unique index if not exists trainer_temp_one_open
  on public.trainer_temp_links (trainer_id, client_id)
  where ended_at is null and converted_at is null;

create index if not exists profiles_listed_idx
  on public.profiles (membership, service_type)
  where listed;

-- Name, role, and verified flag. Never an email.
create or replace function private.public_person(uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  person public.profiles;
  role_label text;
  name_fallback text;
begin
  if uid is null then
    return jsonb_build_object('name', 'Member', 'role', 'Member', 'verified', false);
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

revoke all on function private.public_person(uuid) from public, anon, authenticated;

-- Posts and replies count only inside the last 30 days.
-- Active linked clients are the current open trainer_clients rows.
-- Temporary conversations are not clients and are not counted.
create or replace function private.trainer_activity_score(p_trainer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    (
      select count(*)::int
      from public.hub_posts
      where author_id = p_trainer
        and created_at > now() - interval '30 days'
    )
    + (
      select count(*)::int
      from public.hub_replies
      where author_id = p_trainer
        and created_at > now() - interval '30 days'
    )
    + (
      select count(*)::int
      from public.trainer_clients
      where trainer_id = p_trainer
        and ended_at is null
    );
$fn$;

revoke all on function private.trainer_activity_score(uuid) from public, anon, authenticated;

comment on function private.trainer_activity_score(uuid) is
  'Trainer search rank: hub posts in 30 days + hub replies in 30 days + active linked clients.';

create or replace function private.can_find_trainer(me public.profiles)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select public.invite_role(me) is null
    and (
      me.membership in ('free_client', 'enthusiast')
      or coalesce(me.intended_plan, '') in ('enthusiast', 'free_client')
    );
$fn$;

revoke all on function private.can_find_trainer(public.profiles) from public, anon, authenticated;

-- Read access. An expired temporary link stays readable.
-- A permanent link keeps using trainer_clients only.
create or replace function public.message_live(p_trainer uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select (select auth.uid()) is not null
    and (select auth.uid()) in (p_trainer, p_client)
    and (
      exists (
        select 1
        from public.trainer_clients c
        where c.trainer_id = p_trainer
          and c.client_id = p_client
          and c.ended_at is null
      )
      or exists (
        select 1
        from public.trainer_temp_links t
        where t.trainer_id = p_trainer
          and t.client_id = p_client
          and t.ended_at is null
          and t.converted_at is null
      )
    );
$fn$;

-- Send access. Expiry is checked here, in the database.
create or replace function public.message_can_send(p_trainer uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select (select auth.uid()) is not null
    and (select auth.uid()) in (p_trainer, p_client)
    and (
      exists (
        select 1
        from public.trainer_clients c
        where c.trainer_id = p_trainer
          and c.client_id = p_client
          and c.ended_at is null
      )
      or exists (
        select 1
        from public.trainer_temp_links t
        where t.trainer_id = p_trainer
          and t.client_id = p_client
          and t.ended_at is null
          and t.converted_at is null
          and t.expires_at > now()
      )
    );
$fn$;

create or replace function public.message_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null and new.sender_id is distinct from (select auth.uid()) then
      raise exception 'You can only send as yourself.';
    end if;
    new.read_at := null;
    if (select auth.uid()) is not null then
      new.created_at := now();
      if not public.message_can_send(new.trainer_id, new.client_id) then
        if public.message_live(new.trainer_id, new.client_id) then
          raise exception 'This conversation is read-only.';
        end if;
        raise exception 'There is no connection.';
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.trainer_id is distinct from old.trainer_id
       or new.client_id is distinct from old.client_id
       or new.sender_id is distinct from old.sender_id
       or new.body is distinct from old.body
       or new.created_at is distinct from old.created_at then
      raise exception 'Only read state can change.';
    end if;
    if new.read_at is distinct from old.read_at then
      if old.read_at is not null or new.read_at is null then
        raise exception 'Only read state can change.';
      end if;
    end if;
    if (select auth.uid()) is not null and (select auth.uid()) = old.sender_id then
      raise exception 'You cannot mark your own message read.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if (select auth.uid()) is not null then
      raise exception 'Messages cannot be deleted.';
    end if;
    return old;
  end if;
  return null;
end;
$fn$;

create or replace function private.trainer_temp_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  opening boolean := current_setting('app.temp_link', true) = 'on';
  converting boolean := current_setting('app.temp_convert', true) = 'on';
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
    if not opening or new.trainer_id is distinct from uid then
      raise exception 'A conversation starts when you approve a request.';
    end if;
    if new.expires_at is null or new.expires_at <= now() then
      raise exception 'A conversation needs an end date.';
    end if;
    new.created_at := now();
    new.ended_at := null;
    new.converted_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.trainer_id is distinct from old.trainer_id
       or new.client_id is distinct from old.client_id
       or new.request_id is distinct from old.request_id
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at then
      raise exception 'This conversation cannot be changed.';
    end if;
    if converting then
      if new.ended_at is distinct from old.ended_at then
        raise exception 'This conversation cannot be changed.';
      end if;
      if old.converted_at is not null or new.converted_at is null then
        raise exception 'This conversation cannot be changed.';
      end if;
      return new;
    end if;
    if uid not in (old.trainer_id, old.client_id) then
      raise exception 'You cannot change this conversation.';
    end if;
    if new.converted_at is distinct from old.converted_at or old.ended_at is not null then
      raise exception 'This conversation cannot be changed.';
    end if;
    if new.ended_at is null then
      raise exception 'This conversation cannot be changed.';
    end if;
    new.ended_at := now();
    return new;
  end if;

  raise exception 'A conversation cannot be deleted.';
end;
$fn$;

revoke all on function private.trainer_temp_guard() from public, anon, authenticated;

create or replace function private.trainer_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me public.profiles;
  trainer public.profiles;
  open_count int;
  closing boolean := current_setting('app.request_close', true) = 'on';
begin
  if uid is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if tg_op = 'INSERT' then
      new.note := nullif(btrim(coalesce(new.note, '')), '');
    end if;
    return new;
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;

  if tg_op = 'INSERT' then
    if new.client_id is distinct from uid then
      raise exception 'You can only request as yourself.';
    end if;
    select * into me from public.profiles where id = uid;
    if not found or not private.can_find_trainer(me) then
      raise exception 'Find a trainer is for clients and enthusiasts.';
    end if;
    if new.trainer_id is null or new.trainer_id = uid then
      raise exception 'That trainer is not available.';
    end if;
    select * into trainer from public.profiles where id = new.trainer_id;
    if not found
       or trainer.membership not in ('trainer', 'master_trainer')
       or not coalesce(trainer.listed, false)
       or trainer.service_type not in ('online', 'both')
       or not private.is_approved(trainer.id) then
      raise exception 'That trainer is not available.';
    end if;
    if exists (
      select 1 from public.trainer_clients c
      where c.trainer_id = new.trainer_id
        and c.client_id = uid
        and c.ended_at is null
    ) then
      raise exception 'You are already connected to this trainer.';
    end if;
    if exists (
      select 1 from public.trainer_temp_links t
      where t.trainer_id = new.trainer_id
        and t.client_id = uid
        and t.ended_at is null
        and t.converted_at is null
        and t.expires_at > now()
    ) then
      raise exception 'You already have a conversation with this trainer.';
    end if;
    if exists (
      select 1 from public.trainer_requests q
      where q.client_id = uid
        and q.trainer_id = new.trainer_id
        and q.status = 'open'
    ) then
      raise exception 'You already sent a request.';
    end if;
    if exists (
      select 1 from public.trainer_requests q
      where q.client_id = uid
        and q.trainer_id = new.trainer_id
        and q.status = 'declined'
        and q.decided_at > now() - interval '30 days'
    ) then
      raise exception 'You can request this trainer again later.';
    end if;
    select count(*) into open_count
    from public.trainer_requests q
    where q.client_id = uid
      and q.status = 'open';
    if open_count >= 3 then
      raise exception 'You already have 3 open requests.';
    end if;
    new.note := nullif(btrim(coalesce(new.note, '')), '');
    if new.note is not null and char_length(new.note) > 300 then
      raise exception 'Keep the note short.';
    end if;
    new.status := 'open';
    new.decided_at := null;
    new.created_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.client_id is distinct from old.client_id
       or new.trainer_id is distinct from old.trainer_id
       or new.note is distinct from old.note
       or new.created_at is distinct from old.created_at then
      raise exception 'That request cannot be changed.';
    end if;
    if old.status is distinct from 'open' then
      raise exception 'That request is not open.';
    end if;
    if closing then
      if new.status is distinct from 'closed' then
        raise exception 'That request cannot be changed.';
      end if;
      new.decided_at := now();
      return new;
    end if;
    if uid is distinct from old.trainer_id then
      raise exception 'Only that trainer can answer this request.';
    end if;
    if new.status not in ('approved', 'declined') then
      raise exception 'Choose approve or decline.';
    end if;
    new.decided_at := now();
    if new.status = 'declined' then
      return new;
    end if;
    if exists (
      select 1 from public.trainer_clients c
      where c.trainer_id = old.trainer_id
        and c.client_id = old.client_id
        and c.ended_at is null
    ) then
      raise exception 'This person is already connected.';
    end if;
    if exists (
      select 1 from public.trainer_temp_links t
      where t.trainer_id = old.trainer_id
        and t.client_id = old.client_id
        and t.ended_at is null
        and t.converted_at is null
        and t.expires_at > now()
    ) then
      raise exception 'A conversation is already open.';
    end if;
    update public.trainer_temp_links
      set ended_at = now()
      where trainer_id = old.trainer_id
        and client_id = old.client_id
        and ended_at is null
        and converted_at is null
        and expires_at <= now();
    perform set_config('app.temp_link', 'on', true);
    insert into public.trainer_temp_links (trainer_id, client_id, request_id, expires_at)
    values (old.trainer_id, old.client_id, old.id, now() + interval '7 days');
    perform set_config('app.temp_link', 'off', true);
    return new;
  end if;

  raise exception 'A request cannot be deleted.';
end;
$fn$;

revoke all on function private.trainer_requests_guard() from public, anon, authenticated;

drop trigger if exists trainer_requests_guard on public.trainer_requests;
create trigger trainer_requests_guard
  before insert or update or delete on public.trainer_requests
  for each row execute function private.trainer_requests_guard();

drop trigger if exists trainer_temp_guard on public.trainer_temp_links;
create trigger trainer_temp_guard
  before insert or update or delete on public.trainer_temp_links
  for each row execute function private.trainer_temp_guard();

-- Same profile rules as 20261117180000_invite_only_access.sql, plus the
-- trainer-search switch. Only a Trainer or Master Trainer membership can
-- opt in, and the service type is required while the switch is on.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  trainer boolean;
  location_ok boolean;
  profile_fields boolean;
  listing_role boolean;
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
  if new.listed is null then
    new.listed := false;
  end if;
  if new.service_type is not null then
    new.service_type := lower(btrim(new.service_type));
    if new.service_type = '' then
      new.service_type := null;
    end if;
  end if;
  if new.service_type is not null and new.service_type not in ('in_person', 'online', 'both') then
    raise exception 'Choose in person, online, or both.';
  end if;

  listing_role := new.membership in ('trainer', 'master_trainer');
  if auth.uid() is not null and not listing_role then
    if new.listed or new.service_type is not null then
      if new.listed is distinct from coalesce(old.listed, false)
         or new.service_type is distinct from old.service_type then
        raise exception 'Only a Trainer or Master Trainer can be listed.';
      end if;
    end if;
    new.listed := false;
    new.service_type := null;
  end if;
  if auth.uid() is not null and new.listed and new.service_type is null then
    raise exception 'Choose in person, online, or both.';
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

-- p_lat and p_lng are reserved for a distance rank. Near me does not
-- return trainers until location pins exist. Online uses
-- private.trainer_activity_score and keeps the top 10.
create or replace function public.trainer_search(
  p_mode text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me public.profiles;
  mode text := lower(btrim(coalesce(p_mode, '')));
  rows jsonb;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into me from public.profiles where id = uid;
  if not found or not private.can_find_trainer(me) then
    raise exception 'Find a trainer is for clients and enthusiasts.';
  end if;
  -- Touch the reserved coordinates so a later distance branch can use them
  -- without a new function signature. They are not stored or returned.
  if p_lat is not null and p_lng is not null and mode = 'near' then
    mode := 'near';
  end if;
  if mode = 'near' then
    return jsonb_build_object(
      'mode', 'near',
      'comingSoon', true,
      'trainers', '[]'::jsonb
    );
  end if;
  if mode <> 'online' then
    raise exception 'Choose online or near me.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'role', s.role,
      'verified', s.verified,
      'serviceType', s.service_type,
      'request', s.request_state
    )
    order by s.score desc, s.name asc, s.id asc
  ), '[]'::jsonb)
  into rows
  from (
    select
      p.id,
      person.name,
      person.role,
      person.verified,
      p.service_type,
      case
        when exists (
          select 1 from public.trainer_requests q
          where q.client_id = uid
            and q.trainer_id = p.id
            and q.status = 'open'
        ) then 'open'
        when exists (
          select 1 from public.trainer_requests q
          where q.client_id = uid
            and q.trainer_id = p.id
            and q.status = 'declined'
            and q.decided_at > now() - interval '30 days'
        ) then 'cooldown'
        else 'none'
      end as request_state,
      private.trainer_activity_score(p.id) as score
    from public.profiles p
    cross join lateral (
      select
        j->>'name' as name,
        j->>'role' as role,
        coalesce((j->>'verified')::boolean, false) as verified
      from (select private.public_person(p.id) as j) raw
    ) person
    where p.listed
      and p.service_type in ('online', 'both')
      and p.membership in ('trainer', 'master_trainer')
      and private.is_approved(p.id)
      and p.id <> uid
      and not exists (
        select 1 from public.trainer_clients c
        where c.trainer_id = p.id
          and c.client_id = uid
          and c.ended_at is null
      )
      and not exists (
        select 1 from public.trainer_temp_links t
        where t.trainer_id = p.id
          and t.client_id = uid
          and t.ended_at is null
          and t.converted_at is null
          and t.expires_at > now()
      )
    order by private.trainer_activity_score(p.id) desc, person.name asc, p.id asc
    limit 10
  ) s;

  return jsonb_build_object(
    'mode', 'online',
    'comingSoon', false,
    'trainers', rows
  );
end;
$fn$;

create or replace function public.trainer_request_send(p_trainer uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  created public.trainer_requests;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  perform pg_advisory_xact_lock(hashtext('trainer-request:' || uid::text));
  insert into public.trainer_requests (client_id, trainer_id, note)
  values (uid, p_trainer, p_note)
  returning * into created;
  return jsonb_build_object(
    'id', created.id,
    'status', created.status,
    'note', created.note
  );
end;
$fn$;

create or replace function public.trainer_request_decide(p_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  updated public.trainer_requests;
  link public.trainer_temp_links;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  if p_id is null or p_approve is null then
    raise exception 'Choose approve or decline.';
  end if;
  update public.trainer_requests
    set status = case when p_approve then 'approved' else 'declined' end
    where id = p_id
      and trainer_id = uid
      and status = 'open'
    returning * into updated;
  if not found then
    raise exception 'That request is not open.';
  end if;
  if updated.status = 'approved' then
    select * into link
    from public.trainer_temp_links
    where request_id = updated.id
    order by created_at desc
    limit 1;
  end if;
  return jsonb_build_object(
    'id', updated.id,
    'status', updated.status,
    'expiresAt', link.expires_at
  );
end;
$fn$;

create or replace function public.trainer_request_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  rows jsonb;
begin
  if uid is null or not private.is_approved(uid) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'name', person.name,
      'role', person.role,
      'verified', person.verified,
      'note', r.note,
      'at', r.created_at
    )
    order by r.created_at asc, r.id asc
  ), '[]'::jsonb)
  into rows
  from public.trainer_requests r
  cross join lateral (
    select
      j->>'name' as name,
      j->>'role' as role,
      coalesce((j->>'verified')::boolean, false) as verified
    from (select private.public_person(r.client_id) as j) raw
  ) person
  where r.trainer_id = uid
    and r.status = 'open';
  return rows;
end;
$fn$;

create or replace function public.trainer_request_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::int
  from public.trainer_requests r
  where r.status = 'open'
    and r.trainer_id = (select auth.uid())
    and private.is_approved((select auth.uid()));
$fn$;

create or replace function public.trainer_temp_end(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  link public.trainer_temp_links;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  if p_person is null then
    raise exception 'There is no conversation to end.';
  end if;
  update public.trainer_temp_links
    set ended_at = now()
    where ended_at is null
      and converted_at is null
      and (
        (trainer_id = uid and client_id = p_person)
        or (client_id = uid and trainer_id = p_person)
      )
    returning * into link;
  if not found then
    raise exception 'There is no conversation to end.';
  end if;
  return jsonb_build_object('id', link.id, 'ended', true);
end;
$fn$;

drop function if exists public.message_pair(uuid);
drop function if exists public.message_roster();

create function public.message_roster()
returns table (
  person_id uuid,
  name text,
  plan text,
  trainer_id uuid,
  client_id uuid,
  avatar_path text,
  verified boolean,
  temporary boolean,
  expires_at timestamptz,
  can_send boolean,
  days_left integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    case when c.trainer_id = (select auth.uid()) then c.client_id else c.trainer_id end,
    private.shown_name(
      p.display_name,
      case
        when c.trainer_id = (select auth.uid())
         and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
        when c.trainer_id = (select auth.uid()) then 'Client'
        else 'Trainer'
      end
    ),
    case
      when c.trainer_id = (select auth.uid())
        and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
      when c.trainer_id = (select auth.uid()) then 'Free Client'
      else 'Trainer'
    end,
    c.trainer_id,
    c.client_id,
    p.avatar_path,
    coalesce(
      p.membership = 'master_trainer'
      and p.verified_until is not null
      and p.verified_until >= current_date,
      false
    ),
    false,
    null::timestamptz,
    true,
    null::integer
  from public.trainer_clients c
  join public.profiles p
    on p.id = case when c.trainer_id = (select auth.uid()) then c.client_id else c.trainer_id end
  where private.is_approved((select auth.uid()))
    and c.ended_at is null
    and (select auth.uid()) is not null
    and (c.trainer_id = (select auth.uid()) or c.client_id = (select auth.uid()))
  union all
  select
    case when t.trainer_id = (select auth.uid()) then t.client_id else t.trainer_id end,
    private.shown_name(
      p.display_name,
      case
        when t.trainer_id = (select auth.uid())
         and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
        when t.trainer_id = (select auth.uid()) then 'Client'
        else 'Trainer'
      end
    ),
    case
      when t.trainer_id = (select auth.uid())
        and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
      when t.trainer_id = (select auth.uid()) then 'Free Client'
      else 'Trainer'
    end,
    t.trainer_id,
    t.client_id,
    p.avatar_path,
    coalesce(
      p.membership = 'master_trainer'
      and p.verified_until is not null
      and p.verified_until >= current_date,
      false
    ),
    true,
    t.expires_at,
    t.expires_at > now(),
    case
      when t.expires_at <= now() then 0
      else ceil(extract(epoch from (t.expires_at - now())) / 86400.0)::integer
    end
  from public.trainer_temp_links t
  join public.profiles p
    on p.id = case when t.trainer_id = (select auth.uid()) then t.client_id else t.trainer_id end
  where private.is_approved((select auth.uid()))
    and t.ended_at is null
    and t.converted_at is null
    and (select auth.uid()) is not null
    and (t.trainer_id = (select auth.uid()) or t.client_id = (select auth.uid()))
    and not exists (
      select 1
      from public.trainer_clients c
      where c.trainer_id = t.trainer_id
        and c.client_id = t.client_id
        and c.ended_at is null
    );
$fn$;

create function public.message_pair(p_person uuid)
returns table (trainer uuid, client uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.trainer_id, r.client_id
  from public.message_roster() r
  where p_person is not null
    and r.person_id = p_person
  limit 1;
$fn$;

create or replace function public.message_threads()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me public.profiles;
  role text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
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
    'requestCount', case when role = 'trainer' then public.trainer_request_count() else 0 end,
    'requests', case when role = 'trainer' then public.trainer_request_inbox() else '[]'::jsonb end,
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.person_id,
        'name', r.name,
        'plan', r.plan,
        'avatarPath', r.avatar_path,
        'verified', r.verified,
        'temporary', r.temporary,
        'canSend', r.can_send,
        'daysLeft', r.days_left,
        'expiresAt', r.expires_at,
        'preview', lm.body,
        'at', lm.created_at,
        'unread', (
          select count(*)::int from public.messages m
          where m.trainer_id = r.trainer_id
            and m.client_id = r.client_id
            and m.sender_id <> uid
            and m.read_at is null
        )
      ) order by lm.created_at desc nulls last, r.name)
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
$fn$;

create or replace function public.message_open(p_person uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  pair record;
  person jsonb;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into pair from public.message_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  select jsonb_build_object(
    'id', r.person_id,
    'name', r.name,
    'plan', r.plan,
    'avatarPath', r.avatar_path,
    'verified', r.verified,
    'temporary', r.temporary,
    'canSend', r.can_send,
    'daysLeft', r.days_left,
    'expiresAt', r.expires_at
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
$fn$;

create or replace function public.message_send(p_person uuid, p_id uuid, p_body text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  pair record;
  clean text := btrim(coalesce(p_body, ''));
  created public.messages;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  if p_id is null then raise exception 'Could not send that message.'; end if;
  if char_length(clean) < 1 or char_length(clean) > 2000 then
    raise exception 'Enter a message.';
  end if;
  select * into pair from public.message_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  if not public.message_can_send(pair.trainer, pair.client) then
    if public.message_live(pair.trainer, pair.client) then
      raise exception 'This conversation is read-only.';
    end if;
    raise exception 'There is no connection.';
  end if;
  begin
    insert into public.messages (id, trainer_id, client_id, sender_id, body)
    values (p_id, pair.trainer, pair.client, uid, clean)
    on conflict (id) do nothing
    returning * into created;
  exception
    when insufficient_privilege then
      raise exception 'There is no connection.';
  end;
  if not found then
    select * into created from public.messages where id = p_id;
    if not found
       or created.sender_id is distinct from uid
       or created.trainer_id is distinct from pair.trainer
       or created.client_id is distinct from pair.client then
      raise exception 'Could not send that message.';
    end if;
  end if;
  return jsonb_build_object(
    'id', created.id,
    'senderId', created.sender_id,
    'mine', true,
    'body', created.body,
    'at', created.created_at,
    'readAt', created.read_at
  );
end;
$fn$;

create or replace function public.message_read(p_person uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  pair record;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into pair from public.message_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  update public.messages
    set read_at = now()
    where trainer_id = pair.trainer
      and client_id = pair.client
      and sender_id <> uid
      and read_at is null;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- A real link code replaces the temporary conversation. The messages stay
-- on the same trainer and client ids. Open requests are closed, not
-- declined, so the 30-day wait does not start.
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
  perform set_config('app.temp_convert', 'on', true);
  update public.trainer_temp_links
    set converted_at = now()
    where trainer_id = inv.trainer_id
      and client_id = uid
      and ended_at is null
      and converted_at is null;
  perform set_config('app.temp_convert', 'off', true);
  perform set_config('app.request_close', 'on', true);
  update public.trainer_requests
    set status = 'closed'
    where trainer_id = inv.trainer_id
      and client_id = uid
      and status = 'open';
  perform set_config('app.request_close', 'off', true);
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

alter table public.trainer_requests enable row level security;
alter table public.trainer_temp_links enable row level security;

revoke all on public.trainer_requests from public, anon, authenticated;
revoke all on public.trainer_temp_links from public, anon, authenticated;
grant select on public.trainer_requests to authenticated;
grant select on public.trainer_temp_links to authenticated;

drop policy if exists trainer_requests_select on public.trainer_requests;
create policy trainer_requests_select
  on public.trainer_requests
  for select
  to authenticated
  using (
    private.is_approved((select auth.uid()))
    and (
      client_id = (select auth.uid())
      or trainer_id = (select auth.uid())
    )
  );

drop policy if exists trainer_temp_select on public.trainer_temp_links;
create policy trainer_temp_select
  on public.trainer_temp_links
  for select
  to authenticated
  using (
    private.is_approved((select auth.uid()))
    and (
      client_id = (select auth.uid())
      or trainer_id = (select auth.uid())
    )
  );

-- Sending uses message_can_send so an expired temporary link cannot insert.
drop policy if exists messages_insert_live on public.messages;
create policy messages_insert_live
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and read_at is null
    and (select public.message_can_send(trainer_id, client_id))
    and private.is_approved((select auth.uid()))
  );

revoke all on function public.message_live(uuid, uuid) from public, anon;
revoke all on function public.message_can_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.message_roster() from public, anon, authenticated;
revoke all on function public.message_pair(uuid) from public, anon, authenticated;
revoke all on function public.message_guard() from public, anon, authenticated;
revoke all on function public.message_threads() from public, anon, authenticated;
revoke all on function public.message_open(uuid) from public, anon, authenticated;
revoke all on function public.message_send(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.message_read(uuid) from public, anon, authenticated;
revoke all on function public.trainer_search(text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.trainer_request_send(uuid, text) from public, anon, authenticated;
revoke all on function public.trainer_request_decide(uuid, boolean) from public, anon, authenticated;
revoke all on function public.trainer_request_inbox() from public, anon, authenticated;
revoke all on function public.trainer_request_count() from public, anon, authenticated;
revoke all on function public.trainer_temp_end(uuid) from public, anon, authenticated;

grant execute on function public.message_live(uuid, uuid) to authenticated;
grant execute on function public.message_can_send(uuid, uuid) to authenticated;
grant execute on function public.message_roster() to authenticated;
grant execute on function public.message_pair(uuid) to authenticated;
grant execute on function public.message_guard() to authenticated;
grant execute on function public.message_threads() to authenticated;
grant execute on function public.message_open(uuid) to authenticated;
grant execute on function public.message_send(uuid, uuid, text) to authenticated;
grant execute on function public.message_read(uuid) to authenticated;
grant execute on function public.trainer_search(text, double precision, double precision) to authenticated;
grant execute on function public.trainer_request_send(uuid, text) to authenticated;
grant execute on function public.trainer_request_decide(uuid, boolean) to authenticated;
grant execute on function public.trainer_request_inbox() to authenticated;
grant execute on function public.trainer_request_count() to authenticated;
grant execute on function public.trainer_temp_end(uuid) to authenticated;

notify pgrst, 'reload schema';
