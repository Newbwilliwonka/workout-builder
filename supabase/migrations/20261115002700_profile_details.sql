-- Profile name, photo, location, and bio.
-- Apply once in the Supabase SQL editor AFTER 20261112200000_account_workouts.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app, and do not deploy anything with it.
-- This file was not applied to the live project.
--
-- What a person can store on their own row:
--   Name (display_name). A nickname is enough. Empty is allowed until they
--   save one, so existing accounts keep working. Once a name is saved, the
--   signed-in person cannot clear it.
--   City and state, or Online only. Trainer and Master Trainer (including a
--   chosen Trainer plan that is not paid yet) must have one or the other
--   when they save a name. Clients and Enthusiasts may leave location blank.
--   A short bio, up to 150 characters.
--   A profile photo path. The file itself lives in the private avatars bucket.
--
-- Who can see what:
--   A person can read and edit only their own profiles row.
--   A linked trainer or client can read that person's name and photo path
--   from linked_profile_cards, and can read the photo file from Storage.
--   They cannot read the email from that view.
--   trainer_directory is the later trainer-search list (name, city, state,
--   online only, bio). It is not granted to the app yet. It does not include
--   email or the photo.
--
-- Names replace emails in the places other people already see:
--   invite roster, the linked trainer, message titles, client status, and
--   the "from your trainer" label on a sent workout. If no name is saved,
--   the email is still used.

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists online_only boolean not null default false,
  add column if not exists bio text,
  add column if not exists avatar_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_display_name_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_display_name_len
      check (display_name is null or char_length(display_name) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_city_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_city_len
      check (city is null or char_length(city) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_state_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_state_len
      check (state is null or char_length(state) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_bio_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_len
      check (bio is null or char_length(bio) between 1 and 150);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_avatar_path_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_check
      check (avatar_path is null or avatar_path = id::text || '/avatar.jpg');
  end if;
end $$;

create index if not exists trainer_clients_trainer_open
  on public.trainer_clients (trainer_id, client_id)
  where ended_at is null;

-- Keeps the invite rule from 20261107160000_invites.sql and adds the
-- profile rules above. Other updates (plan, sharing) still succeed when a
-- trainer has not filled location yet, so this file does not lock them out.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  trainer boolean;
  location_ok boolean;
  profile_fields boolean;
begin
  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
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
$$;

-- True for the signed-in person and for someone on an open trainer/client link.
create or replace function public.profile_is_linked(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select other is not null
    and auth.uid() is not null
    and (
      other = (select auth.uid())
      or exists (
        select 1
        from public.trainer_clients tc
        where tc.ended_at is null
          and (
            (tc.trainer_id = (select auth.uid()) and tc.client_id = other)
            or (tc.client_id = (select auth.uid()) and tc.trainer_id = other)
          )
      )
    );
$$;

create or replace function public.profile_card(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
    'avatarPath', row.avatar_path
  );
end;
$$;

create or replace function public.profile_owns_avatar(object_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
    and object_name = (select auth.uid())::text || '/avatar.jpg';
$$;

create or replace function public.profile_can_read_avatar(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folder text;
begin
  if (select auth.uid()) is null or object_name is null then
    return false;
  end if;
  folder := (storage.foldername(object_name))[1];
  if folder is null or folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.profile_is_linked(folder::uuid);
end;
$$;

-- security_invoker stays off so a linked person can read these columns even
-- though profiles itself only lets them select their own row. The where
-- clause is the access check. Email is not in the list.
create or replace view public.linked_profile_cards
with (security_invoker = false) as
select
  p.id,
  nullif(btrim(p.display_name), '') as display_name,
  p.avatar_path
from public.profiles p
where public.profile_is_linked(p.id);

revoke all on table public.linked_profile_cards from public, anon, authenticated;
grant select on table public.linked_profile_cards to authenticated;

-- Not granted. Trainer search can grant select on this view later.
create or replace view public.trainer_directory
with (security_invoker = false) as
select
  p.id,
  nullif(btrim(p.display_name), '') as display_name,
  nullif(btrim(p.city), '') as city,
  nullif(btrim(p.state), '') as state,
  p.online_only,
  nullif(btrim(p.bio), '') as bio
from public.profiles p
where p.membership in ('trainer', 'master_trainer')
  and nullif(btrim(p.display_name), '') is not null;

revoke all on table public.trainer_directory from public, anon, authenticated;

create or replace function public.invite_roster()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  role text;
  cap int;
  client_count int;
  open_count int;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  role := public.invite_role(me);
  if role is null then return jsonb_build_object('role', null); end if;
  cap := public.invite_cap(role);
  select count(*) into client_count from public.trainer_clients where trainer_id = uid and ended_at is null;
  select count(*) into open_count from public.invites
    where trainer_id = uid and used_at is null and canceled_at is null and expires_at > now();
  return jsonb_build_object(
    'role', role,
    'cap', cap,
    'clientCount', client_count,
    'canCreate', (client_count + open_count) < cap,
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.client_id,
        'email', p.email,
        'name', nullif(btrim(p.display_name), ''),
        'avatarPath', p.avatar_path,
        'plan', case when p.membership = 'enthusiast' or p.intended_plan = 'enthusiast' then 'Enthusiast' else 'Free Client' end
      ) order by coalesce(nullif(btrim(p.display_name), ''), p.email))
      from public.trainer_clients c
      join public.profiles p on p.id = c.client_id
      where c.trainer_id = uid and c.ended_at is null
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('code', i.code, 'expiresAt', i.expires_at) order by i.expires_at)
      from public.invites i
      where i.trainer_id = uid and i.used_at is null and i.canceled_at is null and i.expires_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.invite_mine()
returns jsonb
language plpgsql
security definer
set search_path = public
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
    'avatarPath', trainer.avatar_path
  );
end;
$$;

-- The email column stays so the return type does not change. Its value is
-- the display name when one is saved, otherwise the email address.
create or replace function public.message_roster()
returns table (
  person_id uuid,
  email text,
  plan text,
  trainer_id uuid,
  client_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when c.trainer_id = auth.uid() then c.client_id else c.trainer_id end,
    coalesce(
      nullif(btrim(p.display_name), ''),
      p.email,
      case when c.trainer_id = auth.uid() then 'Client' else 'Trainer' end
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
  where c.ended_at is null
    and auth.uid() is not null
    and (c.trainer_id = auth.uid() or c.client_id = auth.uid());
$$;

create or replace function public.message_threads()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
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
set search_path = public
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
    'avatarPath', public.profile_card(r.person_id)->>'avatarPath'
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

create or replace function public.share_status(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  client public.profiles;
  enthusiast boolean;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found or public.invite_role(me) is null then
    raise exception 'Only a trainer can view a client.';
  end if;
  if p_client is null or not exists (
    select 1 from public.trainer_clients
    where trainer_id = uid and client_id = p_client and ended_at is null
  ) then
    raise exception 'There is no connection.';
  end if;
  select * into client from public.profiles where id = p_client;
  if not found then raise exception 'There is no connection.'; end if;
  enthusiast := coalesce(client.membership, '') = 'enthusiast'
    or coalesce(client.intended_plan, '') = 'enthusiast';
  return jsonb_build_object(
    'linked', true,
    'enthusiast', enthusiast,
    'shared', enthusiast and client.share_with_trainer,
    'email', client.email,
    'name', nullif(btrim(client.display_name), ''),
    'avatarPath', client.avatar_path,
    'plan', case when enthusiast then 'Enthusiast' else 'Free Client' end
  );
end;
$$;

create or replace function public.workout_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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

revoke all on function public.profile_is_linked(uuid) from public, anon, authenticated;
revoke all on function public.profile_card(uuid) from public, anon, authenticated;
revoke all on function public.profile_owns_avatar(text) from public, anon, authenticated;
revoke all on function public.profile_can_read_avatar(text) from public, anon, authenticated;
grant execute on function public.profile_is_linked(uuid) to authenticated;
grant execute on function public.profile_card(uuid) to authenticated;
grant execute on function public.profile_owns_avatar(text) to authenticated;
grant execute on function public.profile_can_read_avatar(text) to authenticated;

-- The avatar file is private. Upsert needs select, insert, and update.
-- This block does nothing when Storage is not installed (local tests).
-- On the Supabase project it creates the bucket and the policies.
do $avatars$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Avatar bucket was not created here because Supabase Storage is not installed. Run this file in the Supabase SQL editor.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', false)
  on conflict (id) do update set public = false;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    update storage.buckets set file_size_limit = 524288 where id = 'avatars';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets set allowed_mime_types = array['image/jpeg']::text[] where id = 'avatars';
  end if;

  execute 'alter table storage.objects enable row level security';
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
      and public.profile_can_read_avatar(name)
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
