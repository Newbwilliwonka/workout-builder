-- Private location pin for clients and enthusiasts.
-- Apply once in the Supabase SQL editor AFTER 20261123030000_trainer_search_linked_first.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file does not change trainer_search.
-- The client passes its own latitude and longitude to the existing
-- trainer_search(text, double precision, double precision). That function
-- still sorts and rounds only. It does not read this table, and it does
-- not store the point.
-- Safe to run again. A second run does not duplicate rows, policies, or indexes.
--
-- What it creates
--   private.client_locations
--     One row per person. Exact latitude and longitude, plus the city,
--     region, and country the owner sees on their own map. There is no
--     public table, view, or profile column for them. trainer_search does
--     not read this table, so a trainer result never includes this pin,
--     this city, or this person's email.
--     authenticated can select, insert, update, and delete only their own
--     row. anon has no privileges. Row level security enforces the owner
--     check even if a grant is used directly.
--   public.my_client_location()
--     The signed-in client or enthusiast reads their own pin. Anyone else
--     gets null. The result has no email.
--   public.save_client_location(double precision, double precision, text, text, text)
--     The signed-in client or enthusiast saves their one pin. Calling it
--     again updates that same row. It does not take another person's id.
--   public.remove_client_location()
--     The signed-in person deletes their own row.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.client_locations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  city text not null,
  region text not null,
  country text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.client_locations is
  'Private client pins. The owner can select, insert, update, and delete their own row. Nobody else can read it. Search does not return these coordinates, the city, or an email.';

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_locations_lat' and conrelid = 'private.client_locations'::regclass
  ) then
    alter table private.client_locations
      add constraint client_locations_lat check (latitude >= -90 and latitude <= 90);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_locations_lng' and conrelid = 'private.client_locations'::regclass
  ) then
    alter table private.client_locations
      add constraint client_locations_lng check (longitude >= -180 and longitude <= 180);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_locations_city' and conrelid = 'private.client_locations'::regclass
  ) then
    alter table private.client_locations
      add constraint client_locations_city check (char_length(btrim(city)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_locations_region' and conrelid = 'private.client_locations'::regclass
  ) then
    alter table private.client_locations
      add constraint client_locations_region check (char_length(btrim(region)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_locations_country' and conrelid = 'private.client_locations'::regclass
  ) then
    alter table private.client_locations
      add constraint client_locations_country check (char_length(btrim(country)) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_locations_client' and conrelid = 'private.client_locations'::regclass
  ) then
    alter table private.client_locations
      add constraint client_locations_client unique (client_id);
  end if;
end
$constraints$;

create index if not exists client_locations_client_idx
  on private.client_locations (client_id);

revoke all on table private.client_locations from public, anon, authenticated;
grant select, insert, update, delete on table private.client_locations to authenticated;

alter table private.client_locations enable row level security;

drop policy if exists client_locations_owner on private.client_locations;
create policy client_locations_owner
  on private.client_locations
  for all
  to authenticated
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

create or replace function public.my_client_location()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me public.profiles;
  row private.client_locations;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into me from public.profiles where id = uid;
  if not found or not private.can_find_trainer(me) then
    return null;
  end if;
  select * into row
  from private.client_locations
  where client_id = uid;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', row.id,
    'latitude', row.latitude,
    'longitude', row.longitude,
    'city', row.city,
    'region', row.region,
    'country', row.country
  );
end;
$fn$;

create or replace function public.save_client_location(
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
  saved private.client_locations;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into me from public.profiles where id = uid;
  if not found or not private.can_find_trainer(me) then
    raise exception 'A location pin is for clients and enthusiasts.';
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

  insert into private.client_locations (
    client_id, latitude, longitude, city, region, country
  )
  values (uid, p_lat, p_lng, city, region, country)
  on conflict (client_id) do update
    set latitude = excluded.latitude,
        longitude = excluded.longitude,
        city = excluded.city,
        region = excluded.region,
        country = excluded.country,
        updated_at = now()
  returning * into saved;

  if saved.client_id is distinct from uid then
    raise exception 'That location could not be saved.';
  end if;

  return jsonb_build_object(
    'id', saved.id,
    'latitude', saved.latitude,
    'longitude', saved.longitude,
    'city', saved.city,
    'region', saved.region,
    'country', saved.country
  );
end;
$fn$;

create or replace function public.remove_client_location()
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
  delete from private.client_locations
  where client_id = uid;
  get diagnostics removed = row_count;
  return jsonb_build_object('removed', removed > 0);
end;
$fn$;

revoke all on function public.my_client_location() from public, anon;
revoke all on function public.save_client_location(double precision, double precision, text, text, text) from public, anon;
revoke all on function public.remove_client_location() from public, anon;

grant execute on function public.my_client_location() to authenticated;
grant execute on function public.save_client_location(double precision, double precision, text, text, text) to authenticated;
grant execute on function public.remove_client_location() to authenticated;

notify pgrst, 'reload schema';
