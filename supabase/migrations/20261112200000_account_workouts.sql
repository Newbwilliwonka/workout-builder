-- Workouts saved on the signed-in account, with a copy kept on the device.
-- Apply once in the Supabase SQL editor AFTER 20261112150000_calendar_feeds.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not put a service-role key in the app. The site only calls the functions below.
--
-- This file was not applied to the live project from the app. Until it is
-- applied, workouts stay in browser storage and the rest of the site keeps working.
--
-- What this stores:
--   Each person's own workouts (the ones they built), one row per account and
--   local id. The local id is the same id the program calendar already stores
--   in program_entries.workout_local_id, so a scheduled day still points at
--   the workout. This file does not change program rows. Sent copies stay in
--   workout_copies.
--
-- Who can see a row (row level security, not only the screen):
--   The owner can read and write their own rows.
--   A linked Trainer or Master Trainer can read an Enthusiast's own workouts
--   only while that Enthusiast's share_with_trainer switch is on, and cannot
--   update or delete them.
--   A linked trainer can read, update, and delete a Free Client's workouts.
--   A trainer can read, update, and delete a workout they sent (workout_copies)
--   while the link is still open. An Enthusiast can still edit their own copy.
--   A Free Client still cannot edit a copy a trainer sent.
--   Anyone else, including a trainer whose link has ended, sees nothing.
--
-- Copying browser storage onto the account is one row at a time. A row that
-- is already stored is left as it is, so signing in again does not duplicate
-- it and a newer edit is not replaced by the older browser copy. If a later
-- row fails, the rows already stored stay.
--
-- Two devices: the later revised_at wins. A delete is an edit. An older save
-- does not overwrite a newer one.
--
-- An Enthusiast's plan still stops at 6 workouts for a new save. The one-time
-- copy may keep a library they already built, up to 40, so those workouts are
-- not dropped on the floor. account_seed_close() ends that window. After it
-- runs, another import cannot sneak past the 6. Tracking is not part of this file.
--
-- Safe to run again: tables are created only if missing, functions are
-- replaced, and policies are dropped before they are recreated.

create table if not exists public.account_workouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revised_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint account_workouts_local_len check (char_length(local_id) between 1 and 80),
  constraint account_workouts_name_len check (char_length(name) between 1 and 120),
  constraint account_workouts_items_array check (jsonb_typeof(items) = 'array'),
  constraint account_workouts_owner_local unique (owner_id, local_id)
);

comment on column public.account_workouts.local_id is
  'Same id program_entries.workout_local_id already stores. Scheduling keeps using that id.';

create index if not exists account_workouts_owner_idx
  on public.account_workouts (owner_id, revised_at desc);

-- Ids already copied from a browser. A second sign-in finds the id and does not insert again.
create table if not exists public.account_workout_imports (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  imported_at timestamptz not null default now(),
  primary key (owner_id, local_id)
);

create index if not exists trainer_clients_trainer_open_idx
  on public.trainer_clients (trainer_id, client_id)
  where ended_at is null;

create index if not exists workout_copies_trainer_idx
  on public.workout_copies (trainer_id, owner_id);

-- Set when the one-time browser copy has finished. Until then an import may
-- keep an existing library that is already over the plan cap of 6.
create table if not exists public.account_seed_closed (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  closed_at timestamptz not null default now()
);

alter table public.account_workouts enable row level security;
alter table public.account_workout_imports enable row level security;
alter table public.account_seed_closed enable row level security;

revoke all on public.account_workouts from public, anon, authenticated;
revoke all on public.account_workout_imports from public, anon, authenticated;
revoke all on public.account_seed_closed from public, anon, authenticated;
grant select, insert, update, delete on public.account_workouts to authenticated;

-- Trainer and Master Trainer, matching program_is_trainer.
create or replace function public.account_is_trainer(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_id is not null
    and exists (
      select 1 from public.profiles
      where id = p_id
        and (
          membership in ('trainer', 'master_trainer')
          or (
            membership not in ('trainer', 'master_trainer', 'enthusiast', 'free_client')
            and intended_plan in ('trainer', 'master_trainer')
          )
        )
    );
$$;

create or replace function public.account_is_free_client(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_id is not null
    and exists (
      select 1 from public.profiles
      where id = p_id
        and membership = 'free_client'
    );
$$;

create or replace function public.account_linked(p_trainer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_trainer is not null
    and p_owner is not null
    and exists (
      select 1 from public.trainer_clients
      where trainer_id = p_trainer
        and client_id = p_owner
        and ended_at is null
    );
$$;

-- Read: your own rows, a linked Free Client's rows, or a linked Enthusiast's
-- rows while they are sharing. Sharing off hides the Enthusiast's own workouts.
create or replace function public.account_can_read(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null
    and p_owner is not null
    and (
      p_owner = (select auth.uid())
      or (
        public.account_is_trainer((select auth.uid()))
        and public.account_linked((select auth.uid()), p_owner)
        and (
          public.account_is_free_client(p_owner)
          or (
            public.share_is_enthusiast(p_owner)
            and coalesce((select share_with_trainer from public.profiles where id = p_owner), false)
          )
        )
      )
    );
$$;

-- Write: your own rows, or a linked Free Client's rows when you are their trainer.
-- An Enthusiast's own rows are never writable by the trainer.
create or replace function public.account_can_write(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null
    and p_owner is not null
    and (
      p_owner = (select auth.uid())
      or (
        p_owner <> (select auth.uid())
        and public.account_is_trainer((select auth.uid()))
        and public.account_linked((select auth.uid()), p_owner)
        and public.account_is_free_client(p_owner)
      )
    );
$$;

create or replace function public.account_ms(p_at timestamptz)
returns bigint
language sql
immutable
as $$
  select case
    when p_at is null then null
    else floor(extract(epoch from p_at) * 1000)::bigint
  end;
$$;

create or replace function public.account_from_ms(p_ms bigint)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_ms is null then null
    else to_timestamp(p_ms / 1000.0)
  end;
$$;

create or replace function public.account_workout_json(p_row public.account_workouts)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'localId', p_row.local_id,
    'name', p_row.name,
    'items', p_row.items,
    'revisedAt', public.account_ms(p_row.revised_at),
    'deleted', p_row.deleted_at is not null,
    'createdAt', public.account_ms(p_row.created_at)
  );
$$;

create or replace function public.account_workouts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  importing boolean := current_setting('app.account_import', true) = 'on';
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    if new.revised_at is null then new.revised_at := now(); end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.account_can_write(new.owner_id) then
      raise exception 'You cannot save that workout.';
    end if;
    if public.share_is_enthusiast(new.owner_id) and new.deleted_at is null then
      select count(*) into n from public.account_workouts
        where owner_id = new.owner_id and deleted_at is null;
      if n >= 40 then
        raise exception 'Could not save that workout.';
      end if;
      if n >= 6 and (
        not importing
        or exists (select 1 from public.account_seed_closed where owner_id = new.owner_id)
      ) then
        raise exception 'Your plan includes up to 6 workouts.';
      end if;
    end if;
    if new.revised_at is null then new.revised_at := now(); end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not public.account_can_write(old.owner_id) or not public.account_can_write(new.owner_id) then
      raise exception 'You cannot edit that workout.';
    end if;
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.local_id is distinct from old.local_id
       or new.created_at is distinct from old.created_at then
      raise exception 'That workout cannot be reassigned.';
    end if;
    if public.share_is_enthusiast(new.owner_id)
       and old.deleted_at is not null
       and new.deleted_at is null
       and not importing then
      select count(*) into n from public.account_workouts
        where owner_id = new.owner_id and deleted_at is null;
      if n >= 6 then
        raise exception 'Your plan includes up to 6 workouts.';
      end if;
    end if;
    if new.revised_at is null then new.revised_at := old.revised_at; end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not public.account_can_write(old.owner_id) then
      raise exception 'You cannot delete that workout.';
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists account_workouts_guard on public.account_workouts;
create trigger account_workouts_guard
  before insert or update or delete on public.account_workouts
  for each row execute function public.account_workouts_guard();

drop policy if exists account_workouts_select on public.account_workouts;
create policy account_workouts_select
  on public.account_workouts
  for select
  to authenticated
  using ((select public.account_can_read(owner_id)));

drop policy if exists account_workouts_insert on public.account_workouts;
create policy account_workouts_insert
  on public.account_workouts
  for insert
  to authenticated
  with check ((select public.account_can_write(owner_id)));

drop policy if exists account_workouts_update on public.account_workouts;
create policy account_workouts_update
  on public.account_workouts
  for update
  to authenticated
  using ((select public.account_can_write(owner_id)))
  with check ((select public.account_can_write(owner_id)));

drop policy if exists account_workouts_delete on public.account_workouts;
create policy account_workouts_delete
  on public.account_workouts
  for delete
  to authenticated
  using ((select public.account_can_write(owner_id)));

create or replace function public.account_workout_pull()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.account_workout_json(w) order by w.created_at),
    '[]'::jsonb
  )
  from public.account_workouts w
  where w.owner_id = (select auth.uid());
$$;

create or replace function public.account_workout_push(p_change jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  local text := nullif(btrim(coalesce(p_change->>'localId', '')), '');
  clean text := btrim(coalesce(p_change->>'name', ''));
  want_delete boolean := coalesce(p_change->>'deleted', '') in ('true', 't');
  revised timestamptz;
  existing public.account_workouts;
  stored public.account_workouts;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if local is null or char_length(local) > 80 then
    raise exception 'Could not save that workout.';
  end if;
  if not want_delete and (clean = '' or char_length(clean) > 120) then
    raise exception 'Enter a workout name.';
  end if;
  if not want_delete and (
    jsonb_typeof(p_change->'items') is distinct from 'array'
    or jsonb_array_length(p_change->'items') > 200
    or octet_length((p_change->'items')::text) > 500000
  ) then
    raise exception 'That workout could not be saved.';
  end if;
  if coalesce(p_change->>'revisedAt', '') ~ '^[0-9]+$' then
    revised := public.account_from_ms((p_change->>'revisedAt')::bigint);
  else
    revised := now();
  end if;

  select * into existing from public.account_workouts
    where owner_id = uid and local_id = local;
  if found and existing.revised_at > revised then
    return public.account_workout_json(existing);
  end if;

  if found then
    update public.account_workouts
      set name = case when want_delete then name else clean end,
          items = case when want_delete then items else p_change->'items' end,
          revised_at = revised,
          deleted_at = case when want_delete then revised else null end
      where id = existing.id
      returning * into stored;
  else
    insert into public.account_workouts (owner_id, local_id, name, items, revised_at, deleted_at)
    values (
      uid,
      local,
      case when clean = '' then 'Workout' else clean end,
      case
        when want_delete or jsonb_typeof(p_change->'items') is distinct from 'array' then '[]'::jsonb
        else p_change->'items'
      end,
      revised,
      case when want_delete then revised else null end
    )
    returning * into stored;
  end if;
  if stored.id is null then raise exception 'Could not save that workout.'; end if;
  return public.account_workout_json(stored);
end;
$$;

-- Copies one browser workout onto the account. A local id already copied, or a
-- row already stored, is not inserted again and is not overwritten.
create or replace function public.account_workout_import(p_workout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  local text := nullif(btrim(coalesce(p_workout->>'localId', '')), '');
  clean text := btrim(coalesce(p_workout->>'name', ''));
  revised timestamptz;
  existing public.account_workouts;
  stored public.account_workouts;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if local is null or char_length(local) > 80 then
    raise exception 'Could not save that workout.';
  end if;
  if clean = '' or char_length(clean) > 120 then
    raise exception 'Enter a workout name.';
  end if;
  if jsonb_typeof(p_workout->'items') is distinct from 'array'
     or jsonb_array_length(p_workout->'items') > 200
     or octet_length((p_workout->'items')::text) > 500000 then
    raise exception 'That workout could not be saved.';
  end if;
  if coalesce(p_workout->>'revisedAt', '') ~ '^[0-9]+$' then
    revised := public.account_from_ms((p_workout->>'revisedAt')::bigint);
  else
    revised := now();
  end if;

  if exists (
    select 1 from public.account_workout_imports
    where owner_id = uid and local_id = local
  ) then
    select * into existing from public.account_workouts
      where owner_id = uid and local_id = local;
    if not found then
      return jsonb_build_object('localId', local, 'imported', true, 'created', false);
    end if;
    return public.account_workout_json(existing) || jsonb_build_object('imported', true, 'created', false);
  end if;

  select * into existing from public.account_workouts
    where owner_id = uid and local_id = local;
  if found then
    insert into public.account_workout_imports (owner_id, local_id)
    values (uid, local)
    on conflict (owner_id, local_id) do nothing;
    return public.account_workout_json(existing) || jsonb_build_object('imported', true, 'created', false);
  end if;

  perform set_config('app.account_import', 'on', true);
  insert into public.account_workouts (owner_id, local_id, name, items, revised_at)
  values (uid, local, clean, p_workout->'items', revised)
  returning * into stored;
  insert into public.account_workout_imports (owner_id, local_id)
  values (uid, local)
  on conflict (owner_id, local_id) do nothing;
  return public.account_workout_json(stored) || jsonb_build_object('imported', true, 'created', true);
exception
  when unique_violation then
    select * into existing from public.account_workouts
      where owner_id = uid and local_id = local;
    insert into public.account_workout_imports (owner_id, local_id)
    values (uid, local)
    on conflict (owner_id, local_id) do nothing;
    if existing.id is null then
      return jsonb_build_object('localId', local, 'imported', true, 'created', false);
    end if;
    return public.account_workout_json(existing) || jsonb_build_object('imported', true, 'created', false);
end;
$$;

create or replace function public.account_client_workouts(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  perm text := 'hidden';
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_client is null
     or not public.account_is_trainer(uid)
     or not public.account_linked(uid, p_client) then
    raise exception 'There is no connection.';
  end if;
  if public.account_is_free_client(p_client) then
    perm := 'edit';
  elsif public.share_is_enthusiast(p_client)
        and coalesce((select share_with_trainer from public.profiles where id = p_client), false) then
    perm := 'view';
  end if;
  return jsonb_build_object(
    'permission', perm,
    'workouts', case
      when perm = 'hidden' or not public.account_can_read(p_client) then '[]'::jsonb
      else coalesce((
        select jsonb_agg(public.account_workout_json(w) order by w.created_at)
        from public.account_workouts w
        where w.owner_id = p_client and w.deleted_at is null
      ), '[]'::jsonb)
    end
  );
end;
$$;

create or replace function public.account_client_save(p_client uuid, p_change jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  local text := nullif(btrim(coalesce(p_change->>'localId', '')), '');
  clean text := btrim(coalesce(p_change->>'name', ''));
  want_delete boolean := coalesce(p_change->>'deleted', '') in ('true', 't');
  revised timestamptz;
  existing public.account_workouts;
  stored public.account_workouts;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_client is null or p_client = uid or not public.account_can_write(p_client) then
    raise exception 'A trainer can only view these workouts.';
  end if;
  if local is null or char_length(local) > 80 then
    raise exception 'Could not save that workout.';
  end if;
  if not want_delete and (clean = '' or char_length(clean) > 120) then
    raise exception 'Enter a workout name.';
  end if;
  if not want_delete and (
    jsonb_typeof(p_change->'items') is distinct from 'array'
    or jsonb_array_length(p_change->'items') > 200
    or octet_length((p_change->'items')::text) > 500000
  ) then
    raise exception 'That workout could not be saved.';
  end if;
  if coalesce(p_change->>'revisedAt', '') ~ '^[0-9]+$' then
    revised := public.account_from_ms((p_change->>'revisedAt')::bigint);
  else
    revised := now();
  end if;

  select * into existing from public.account_workouts
    where owner_id = p_client and local_id = local;
  if found and existing.revised_at > revised then
    return public.account_workout_json(existing);
  end if;
  if found then
    update public.account_workouts
      set name = case when want_delete then name else clean end,
          items = case when want_delete then items else p_change->'items' end,
          revised_at = revised,
          deleted_at = case when want_delete then revised else null end
      where id = existing.id
      returning * into stored;
  else
    insert into public.account_workouts (owner_id, local_id, name, items, revised_at, deleted_at)
    values (
      p_client,
      local,
      case when clean = '' then 'Workout' else clean end,
      case
        when want_delete or jsonb_typeof(p_change->'items') is distinct from 'array' then '[]'::jsonb
        else p_change->'items'
      end,
      revised,
      case when want_delete then revised else null end
    )
    returning * into stored;
  end if;
  if stored.id is null then raise exception 'A trainer can only view these workouts.'; end if;
  return public.account_workout_json(stored);
end;
$$;

-- The sending trainer can change a copy while the link is open.
-- An Enthusiast can still change their own copy. A Free Client still cannot.
create or replace function public.workout_copies_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trainer_edit boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.trainer_id is distinct from auth.uid()
       or not public.workout_linked(auth.uid(), new.owner_id) then
      raise exception 'Choose a linked client.';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  trainer_edit := auth.uid() = old.trainer_id
    and public.workout_linked(auth.uid(), old.owner_id);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.trainer_id is distinct from old.trainer_id
       or new.source_workout_id is distinct from old.source_workout_id
       or new.created_at is distinct from old.created_at then
      raise exception 'That workout cannot be reassigned.';
    end if;
    if trainer_edit then
      new.updated_at := now();
      return new;
    end if;
    if old.owner_id is distinct from auth.uid()
       or not public.workout_is_enthusiast(auth.uid()) then
      raise exception 'Only an Enthusiast can edit a workout from a trainer.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if trainer_edit then return old; end if;
    if old.owner_id is distinct from auth.uid()
       or not public.workout_is_enthusiast(auth.uid()) then
      raise exception 'Only an Enthusiast can edit a workout from a trainer.';
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop policy if exists workout_copies_select_trainer on public.workout_copies;
create policy workout_copies_select_trainer
  on public.workout_copies
  for select
  to authenticated
  using (
    trainer_id = (select auth.uid())
    and (select public.workout_linked((select auth.uid()), owner_id))
  );

drop policy if exists workout_copies_update_trainer on public.workout_copies;
create policy workout_copies_update_trainer
  on public.workout_copies
  for update
  to authenticated
  using (
    trainer_id = (select auth.uid())
    and (select public.workout_linked((select auth.uid()), owner_id))
  )
  with check (
    trainer_id = (select auth.uid())
    and (select public.workout_linked((select auth.uid()), owner_id))
  );

drop policy if exists workout_copies_delete_trainer on public.workout_copies;
create policy workout_copies_delete_trainer
  on public.workout_copies
  for delete
  to authenticated
  using (
    trainer_id = (select auth.uid())
    and (select public.workout_linked((select auth.uid()), owner_id))
  );

create or replace function public.workout_sent(p_client uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_client is null or not public.workout_linked(uid, p_client) then
    raise exception 'There is no connection.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id,
      'name', w.name,
      'items', w.items,
      'sourceTrainerId', w.trainer_id,
      'sourceWorkoutId', w.source_workout_id,
      'createdAt', w.created_at,
      'updatedAt', w.updated_at
    ) order by w.created_at desc)
    from public.workout_copies w
    where w.trainer_id = uid and w.owner_id = p_client
  ), '[]'::jsonb);
end;
$$;

create or replace function public.workout_trainer_save(p_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(coalesce(p_name, ''));
  row public.workout_copies;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if clean = '' or char_length(clean) > 120 then
    raise exception 'Enter a workout name.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) > 200
     or octet_length(p_items::text) > 500000 then
    raise exception 'That workout could not be saved.';
  end if;
  update public.workout_copies
    set name = clean, items = p_items
    where id = p_id and trainer_id = uid
    returning * into row;
  if not found then raise exception 'That workout was not found.'; end if;
  return jsonb_build_object('id', row.id, 'name', row.name, 'updatedAt', row.updated_at);
end;
$$;

create or replace function public.workout_trainer_delete(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  removed uuid;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  delete from public.workout_copies
    where id = p_id and trainer_id = uid
    returning id into removed;
  if removed is null then raise exception 'That workout was not found.'; end if;
  return jsonb_build_object('id', removed);
end;
$$;

create or replace function public.account_seed_close()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  insert into public.account_seed_closed (owner_id)
  values (uid)
  on conflict (owner_id) do nothing;
end;
$$;

revoke all on function public.account_is_trainer(uuid) from public, anon, authenticated;
revoke all on function public.account_is_free_client(uuid) from public, anon, authenticated;
revoke all on function public.account_linked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.account_can_read(uuid) from public, anon;
revoke all on function public.account_can_write(uuid) from public, anon;
revoke all on function public.account_ms(timestamptz) from public, anon;
revoke all on function public.account_from_ms(bigint) from public, anon;
revoke all on function public.account_workout_json(public.account_workouts) from public, anon;
revoke all on function public.account_workouts_guard() from public, anon;
revoke all on function public.account_seed_close() from public, anon, authenticated;
revoke all on function public.account_workout_pull() from public, anon, authenticated;
revoke all on function public.account_workout_push(jsonb) from public, anon, authenticated;
revoke all on function public.account_workout_import(jsonb) from public, anon, authenticated;
revoke all on function public.account_client_workouts(uuid) from public, anon, authenticated;
revoke all on function public.account_client_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.workout_sent(uuid) from public, anon, authenticated;
revoke all on function public.workout_trainer_save(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.workout_trainer_delete(uuid) from public, anon, authenticated;

grant execute on function public.account_can_read(uuid) to authenticated;
grant execute on function public.account_can_write(uuid) to authenticated;
grant execute on function public.account_ms(timestamptz) to authenticated;
grant execute on function public.account_from_ms(bigint) to authenticated;
grant execute on function public.account_workout_json(public.account_workouts) to authenticated;
grant execute on function public.account_workouts_guard() to authenticated;
grant execute on function public.account_seed_close() to authenticated;
grant execute on function public.account_workout_pull() to authenticated;
grant execute on function public.account_workout_push(jsonb) to authenticated;
grant execute on function public.account_workout_import(jsonb) to authenticated;
grant execute on function public.account_client_workouts(uuid) to authenticated;
grant execute on function public.account_client_save(uuid, jsonb) to authenticated;
grant execute on function public.workout_sent(uuid) to authenticated;
grant execute on function public.workout_trainer_save(uuid, text, jsonb) to authenticated;
grant execute on function public.workout_trainer_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
