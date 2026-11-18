-- Private service-location pins and Near me search.
-- Apply once in the Supabase SQL editor AFTER 20261118210000_trainer_find.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Safe to run again. A second run does not duplicate rows, policies, or indexes.
-- If 20261118210000_trainer_find.sql is run again after this file, run this
-- file once more. That older file replaces trainer_search and the request guard.
--
-- What it creates
--   private.trainer_locations
--     One row per service pin. id, trainer_id, slot (1 now; 2 and up are
--     reserved so more pins can be added later), latitude, longitude, city,
--     region (state or region), country, created_at, updated_at.
--     The app writes slot 1 only. Exact latitude and longitude live only in
--     this table. There is no public table, view, or profile column for them.
--     anon and authenticated have no privileges on the table. Row level
--     security is on, with a policy that would still limit a later grant to
--     the owning trainer. The table owner reads every pin only from the
--     security definer search function below.
--   private.distance_miles(double precision, double precision, double precision, double precision)
--     Haversine distance in miles. Not granted to anon or authenticated.
--   private.rounded_miles(double precision, double precision, double precision, double precision)
--     That distance rounded to the nearest mile, and at least 1. Not granted
--     to anon or authenticated. Search returns this integer only.
--   public.my_service_locations()
--     The signed-in trainer's own pins, including latitude and longitude.
--     Other people get an empty list. A client cannot read a trainer's pin.
--   public.save_service_location(double precision, double precision, text, text, text)
--     The signed-in Trainer or Master Trainer saves slot 1. City, region, and
--     country are the reverse-geocoded public place. The function does not
--     take a free-typed profile field, and it does not take another person's
--     id. Calling it again updates the same pin.
--   public.remove_service_location()
--     The owner deletes slot 1.
--   public.trainer_search(text, double precision, double precision)
--     Replaces the step 2 function. Online still returns the top 10 listed
--     trainers whose service is online or both, ranked by activity. Each row
--     adds city and state when that trainer has a pin, and omits them when
--     they do not. Near me returns the top 10 listed trainers whose service
--     is in person or both and who have a pin, closest first. Each row has
--     name, role, verified, service type, city, state, distanceMiles (the
--     rounded mile value), and the same request state as before. It does not
--     return latitude, longitude, country, or email. p_lat and p_lng are the
--     client's search point. They are not inserted, updated, or logged.
--   private.trainer_requests_guard()
--     A listed trainer who offers in person can be requested, same as online
--     or both. The step 2 guard allowed only online or both, which blocked
--     the Request to message button on a Near me result.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.trainer_locations (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  slot smallint not null default 1,
  latitude double precision not null,
  longitude double precision not null,
  city text not null,
  region text not null,
  country text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.trainer_locations is
  'Private service pins. Exact coordinates are readable only by the owning trainer through my_service_locations. Search returns city, state, and a rounded distance.';

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_slot' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_slot check (slot >= 1 and slot <= 20);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_lat' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_lat check (latitude >= -90 and latitude <= 90);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_lng' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_lng check (longitude >= -180 and longitude <= 180);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_city' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_city check (char_length(btrim(city)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_region' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_region check (char_length(btrim(region)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_country' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_country check (char_length(btrim(country)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trainer_locations_trainer_slot' and conrelid = 'private.trainer_locations'::regclass
  ) then
    alter table private.trainer_locations
      add constraint trainer_locations_trainer_slot unique (trainer_id, slot);
  end if;
end
$constraints$;

create index if not exists trainer_locations_trainer_idx
  on private.trainer_locations (trainer_id, slot);

revoke all on table private.trainer_locations from public, anon, authenticated;

alter table private.trainer_locations enable row level security;

drop policy if exists trainer_locations_owner on private.trainer_locations;
create policy trainer_locations_owner
  on private.trainer_locations
  for all
  to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));

-- Miles between two points. Callers of trainer_search never see this value.
create or replace function private.distance_miles(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 3958.7613 * 2 * asin(least(1::double precision, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    )))
  end;
$$;

-- Nearest mile, and never 0. A shorter gap still shows as 1 mile.
create or replace function private.rounded_miles(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(1, round(private.distance_miles(lat1, lng1, lat2, lng2))::integer);
$$;

revoke all on function private.distance_miles(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function private.rounded_miles(double precision, double precision, double precision, double precision) from public, anon, authenticated;

create or replace function public.my_service_locations()
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
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'slot', l.slot,
      'latitude', l.latitude,
      'longitude', l.longitude,
      'city', l.city,
      'region', l.region,
      'country', l.country
    )
    order by l.slot asc
  ), '[]'::jsonb)
  into rows
  from private.trainer_locations l
  where l.trainer_id = uid;
  return rows;
end;
$fn$;

create or replace function public.save_service_location(
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_region text,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me public.profiles;
  city text;
  region text;
  country text;
  saved private.trainer_locations;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into me from public.profiles where id = uid;
  if not found or me.membership not in ('trainer', 'master_trainer') then
    raise exception 'Only a Trainer or Master Trainer can set a service location.';
  end if;
  if p_lat is null or p_lng is null
     or p_lat <> p_lat or p_lng <> p_lng
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'Drop a pin on the map.';
  end if;
  city := nullif(btrim(coalesce(p_city, '')), '');
  region := nullif(btrim(coalesce(p_region, '')), '');
  country := nullif(btrim(coalesce(p_country, '')), '');
  if city is null or region is null or country is null
     or char_length(city) > 80
     or char_length(region) > 80
     or char_length(country) > 80 then
    raise exception 'Choose a place with a city and state.';
  end if;

  insert into private.trainer_locations (
    trainer_id, slot, latitude, longitude, city, region, country
  )
  values (uid, 1, p_lat, p_lng, city, region, country)
  on conflict (trainer_id, slot) do update
    set latitude = excluded.latitude,
        longitude = excluded.longitude,
        city = excluded.city,
        region = excluded.region,
        country = excluded.country,
        updated_at = now()
  returning * into saved;

  return jsonb_build_object(
    'id', saved.id,
    'slot', saved.slot,
    'latitude', saved.latitude,
    'longitude', saved.longitude,
    'city', saved.city,
    'region', saved.region,
    'country', saved.country
  );
end;
$fn$;

create or replace function public.remove_service_location()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  removed int;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  delete from private.trainer_locations
  where trainer_id = uid
    and slot = 1;
  get diagnostics removed = row_count;
  return jsonb_build_object('removed', removed > 0);
end;
$fn$;

-- Same ranking and filters as step 2, plus public city and state from a pin.
-- Near me uses the caller's point only to sort and round. It does not store it.
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

  if mode = 'near' then
    if p_lat is null or p_lng is null
       or p_lat <> p_lat or p_lng <> p_lng
       or p_lat < -90 or p_lat > 90
       or p_lng < -180 or p_lng > 180 then
      raise exception 'Choose a location.';
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'role', s.role,
        'verified', s.verified,
        'serviceType', s.service_type,
        'city', s.city,
        'state', s.region,
        'distanceMiles', s.miles,
        'request', s.request_state
      )
      order by s.exact_miles asc, s.name asc, s.id asc
    ), '[]'::jsonb)
    into rows
    from (
      select
        p.id,
        person.name,
        person.role,
        person.verified,
        p.service_type,
        place.city,
        place.region,
        place.miles,
        place.exact_miles,
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
        end as request_state
      from public.profiles p
      cross join lateral (
        select
          j->>'name' as name,
          j->>'role' as role,
          coalesce((j->>'verified')::boolean, false) as verified
        from (select private.public_person(p.id) as j) raw
      ) person
      join lateral (
        select
          l.city,
          l.region,
          private.distance_miles(p_lat, p_lng, l.latitude, l.longitude) as exact_miles,
          private.rounded_miles(p_lat, p_lng, l.latitude, l.longitude) as miles
        from private.trainer_locations l
        where l.trainer_id = p.id
        order by private.distance_miles(p_lat, p_lng, l.latitude, l.longitude) asc, l.slot asc
        limit 1
      ) place on true
      where p.listed
        and p.service_type in ('in_person', 'both')
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
      order by place.exact_miles asc, person.name asc, p.id asc
      limit 10
    ) s;

    return jsonb_build_object(
      'mode', 'near',
      'comingSoon', false,
      'trainers', rows
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
      'city', s.city,
      'state', s.region,
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
      place.city,
      place.region,
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
    left join lateral (
      select l.city, l.region
      from private.trainer_locations l
      where l.trainer_id = p.id
      order by l.slot asc
      limit 1
    ) place on true
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

-- In person is requestable now that Near me lists those trainers.
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
       or trainer.service_type not in ('in_person', 'online', 'both')
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

revoke all on function public.my_service_locations() from public, anon;
revoke all on function public.save_service_location(double precision, double precision, text, text, text) from public, anon;
revoke all on function public.remove_service_location() from public, anon;
revoke all on function public.trainer_search(text, double precision, double precision) from public, anon;

grant execute on function public.my_service_locations() to authenticated;
grant execute on function public.save_service_location(double precision, double precision, text, text, text) to authenticated;
grant execute on function public.remove_service_location() to authenticated;
grant execute on function public.trainer_search(text, double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
