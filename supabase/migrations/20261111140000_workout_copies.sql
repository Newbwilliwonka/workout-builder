-- Independent workout copies from a trainer to each linked client.
-- Apply once in the Supabase SQL editor AFTER 20261111120000_messages.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not put a service-role key in the app. The site only calls the functions below.
--
-- This file does not change messages, invites, or the player. It was not applied
-- to the live project from the app. Until it is applied, Send workout and the
-- received-workout list say "Not available yet" and the rest of the site keeps working.
--
-- A trainer sends one workout to one or more linked clients (Free Client or
-- Enthusiast). Each recipient gets a new row they own. The items are a copy, so
-- later edits to the trainer's workout do not change it. The id is chosen by the
-- sender. Sending that id again does not insert a second row and does not change
-- the first. An Enthusiast may edit or delete their copy. A Free Client may read
-- and run it, and the database rejects their edits.

create table if not exists public.workout_copies (
  id uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  source_workout_id text,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_copies_name_len check (char_length(name) between 1 and 120),
  constraint workout_copies_items_array check (jsonb_typeof(items) = 'array'),
  constraint workout_copies_distinct_pair check (owner_id <> trainer_id)
);

create index if not exists workout_copies_owner_idx
  on public.workout_copies (owner_id, created_at desc);

alter table public.workout_copies enable row level security;

revoke all on public.workout_copies from public, anon, authenticated;
grant select, insert, update, delete on public.workout_copies to authenticated;

-- True only when the signed-in person is one side of a link that has not ended.
create or replace function public.workout_linked(p_trainer uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_trainer is not null
    and p_client is not null
    and auth.uid() in (p_trainer, p_client)
    and exists (
      select 1 from public.trainer_clients
      where trainer_id = p_trainer
        and client_id = p_client
        and ended_at is null
    );
$$;

-- The signed-in person, and only them, when they are an Enthusiast.
create or replace function public.workout_is_enthusiast(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_id is not null
    and p_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = p_id
        and (membership = 'enthusiast' or intended_plan = 'enthusiast')
    );
$$;

-- Used after insert ... on conflict do nothing. Does not return the workout.
create or replace function public.workout_same_delivery(p_id uuid, p_client uuid, p_trainer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and auth.uid() = p_trainer
    and exists (
      select 1 from public.workout_copies
      where id = p_id
        and owner_id = p_client
        and trainer_id = p_trainer
    );
$$;

create or replace function public.workout_copies_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.trainer_id is distinct from old.trainer_id
       or new.source_workout_id is distinct from old.source_workout_id
       or new.created_at is distinct from old.created_at then
      raise exception 'That workout cannot be reassigned.';
    end if;
    if old.owner_id is distinct from auth.uid()
       or not public.workout_is_enthusiast(auth.uid()) then
      raise exception 'Only an Enthusiast can edit a workout from a trainer.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.owner_id is distinct from auth.uid()
       or not public.workout_is_enthusiast(auth.uid()) then
      raise exception 'Only an Enthusiast can edit a workout from a trainer.';
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists workout_copies_guard on public.workout_copies;
create trigger workout_copies_guard
  before insert or update or delete on public.workout_copies
  for each row execute function public.workout_copies_guard();

drop policy if exists workout_copies_select_own on public.workout_copies;
create policy workout_copies_select_own
  on public.workout_copies
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists workout_copies_insert_linked on public.workout_copies;
create policy workout_copies_insert_linked
  on public.workout_copies
  for insert
  to authenticated
  with check (
    trainer_id = (select auth.uid())
    and owner_id <> (select auth.uid())
    and (select public.workout_linked((select auth.uid()), owner_id))
  );

drop policy if exists workout_copies_update_enthusiast on public.workout_copies;
create policy workout_copies_update_enthusiast
  on public.workout_copies
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.workout_is_enthusiast((select auth.uid())))
  )
  with check (
    owner_id = (select auth.uid())
    and (select public.workout_is_enthusiast((select auth.uid())))
  );

drop policy if exists workout_copies_delete_enthusiast on public.workout_copies;
create policy workout_copies_delete_enthusiast
  on public.workout_copies
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.workout_is_enthusiast((select auth.uid())))
  );

-- One call inserts every recipient, or none of them. A repeated id is a no-op.
-- Security definer because the trainer must not be able to read the client's
-- copy, and Postgres rejects INSERT ... ON CONFLICT unless the caller can see
-- that row. The checks below, plus the guard trigger, are what limit the write:
-- only a trainer, only a linked client, and an existing id is left unchanged.
create or replace function public.workout_send(
  p_deliveries jsonb,
  p_name text,
  p_items jsonb,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  clean text := btrim(coalesce(p_name, ''));
  source text := nullif(btrim(coalesce(p_source, '')), '');
  item jsonb;
  copy_id uuid;
  client_id uuid;
  seen_clients uuid[] := '{}';
  seen_ids uuid[] := '{}';
  n int := 0;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  if me.membership not in ('trainer', 'master_trainer')
     and coalesce(me.intended_plan, '') not in ('trainer', 'master_trainer') then
    raise exception 'Only a trainer can send a workout.';
  end if;
  if clean = '' or char_length(clean) > 120 then
    raise exception 'Enter a workout name.';
  end if;
  if source is not null and char_length(source) > 80 then
    raise exception 'That workout could not be sent.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) > 200
     or octet_length(p_items::text) > 500000 then
    raise exception 'That workout could not be sent.';
  end if;
  if jsonb_typeof(p_deliveries) is distinct from 'array'
     or jsonb_array_length(p_deliveries) < 1
     or jsonb_array_length(p_deliveries) > 30 then
    raise exception 'Choose a linked client.';
  end if;

  for item in select value from jsonb_array_elements(p_deliveries)
  loop
    begin
      copy_id := (item->>'id')::uuid;
      client_id := (item->>'clientId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Choose a linked client.';
    end;
    if copy_id is null or client_id is null
       or client_id = any (seen_clients)
       or copy_id = any (seen_ids) then
      raise exception 'Choose a linked client.';
    end if;
    seen_clients := seen_clients || client_id;
    seen_ids := seen_ids || copy_id;
    if not public.workout_linked(uid, client_id) then
      raise exception 'Choose a linked client.';
    end if;
    begin
      insert into public.workout_copies (id, owner_id, trainer_id, source_workout_id, name, items)
      values (copy_id, client_id, uid, source, clean, p_items)
      on conflict (id) do nothing;
    exception
      when unique_violation then
        null;
      when insufficient_privilege then
        raise exception 'Choose a linked client.';
      when check_violation then
        raise exception 'That workout could not be sent.';
    end;
    if not public.workout_same_delivery(copy_id, client_id, uid) then
      raise exception 'Could not send that workout.';
    end if;
    n := n + 1;
  end loop;

  return jsonb_build_object('name', clean, 'count', n);
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

create or replace function public.workout_save(p_id uuid, p_name text, p_items jsonb)
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
  if not public.workout_is_enthusiast(uid) then
    raise exception 'Only an Enthusiast can edit a workout from a trainer.';
  end if;
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
    where id = p_id and owner_id = uid
    returning * into row;
  if not found then raise exception 'That copy was not found.'; end if;
  return jsonb_build_object('id', row.id, 'name', row.name, 'updatedAt', row.updated_at);
end;
$$;

create or replace function public.workout_delete(p_id uuid)
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
  if not public.workout_is_enthusiast(uid) then
    raise exception 'Only an Enthusiast can edit a workout from a trainer.';
  end if;
  delete from public.workout_copies
    where id = p_id and owner_id = uid
    returning id into removed;
  if removed is null then raise exception 'That copy was not found.'; end if;
  return jsonb_build_object('id', removed);
end;
$$;

revoke all on function public.workout_linked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.workout_is_enthusiast(uuid) from public, anon, authenticated;
revoke all on function public.workout_same_delivery(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.workout_copies_guard() from public, anon, authenticated;
revoke all on function public.workout_send(jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.workout_mine() from public, anon, authenticated;
revoke all on function public.workout_save(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.workout_delete(uuid) from public, anon, authenticated;

grant execute on function public.workout_linked(uuid, uuid) to authenticated;
grant execute on function public.workout_is_enthusiast(uuid) to authenticated;
grant execute on function public.workout_same_delivery(uuid, uuid, uuid) to authenticated;
grant execute on function public.workout_send(jsonb, text, jsonb, text) to authenticated;
grant execute on function public.workout_mine() to authenticated;
grant execute on function public.workout_save(uuid, text, jsonb) to authenticated;
grant execute on function public.workout_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
