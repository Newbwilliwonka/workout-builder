-- Trainer profile: service replaces the Online only box, and a typed city
-- is no longer required.
-- Apply once in the Supabase SQL editor AFTER 20261118230000_trainer_near.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. Safe to run again.
--
-- What changes
--   A trainer can save a name, photo, and bio without typing a city and
--   state, and without turning on Online only. City and state for search
--   come from the service pin (private.trainer_locations), which already
--   supplies the public place in trainer_search.
--   online_only stays. Choosing service Online sets it true. In person and
--   In Person and Online (stored as both) set it false. A profile that
--   still has no service keeps whatever online_only it already has, so
--   older rows are not wiped until the trainer saves a service.
--   trainer_search does not read online_only. Online results are trainers
--   whose service is online or both. Near me results are in_person or both
--   and only include a trainer who has a pin. No change to that function.

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
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
    raise exception 'Choose Online, In person, or In Person and Online.';
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
    raise exception 'Choose Online, In person, or In Person and Online.';
  end if;

  if new.service_type = 'online' then
    new.online_only := true;
  elsif new.service_type in ('in_person', 'both') then
    new.online_only := false;
  end if;

  if auth.uid() is not null
     and nullif(btrim(coalesce(old.display_name, '')), '') is not null
     and new.display_name is null then
    raise exception 'Enter your name.';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

comment on column public.profiles.online_only is
  'True when the trainer service is online. In person and both leave it false. Rows with no service keep the previous value.';
