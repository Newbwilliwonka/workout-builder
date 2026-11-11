-- Messages, sent workout copies, and an Enthusiast's choice to share their own
-- workouts and tracking with their trainer.
-- Apply in the Supabase SQL editor AFTER 20261107160000_invites.sql.
-- Dashboard → SQL → New query → paste this file → Run.
-- Do not put a service-role key in the app. The site only calls the functions below.
-- Until this file is applied, the site hides these actions instead of breaking.
--
-- A trainer and a linked client (Free Client or linked Enthusiast) can message
-- only while the connection is active. Sending a workout inserts a new row owned
-- by the client. The trainer's workout is never updated. Only an Enthusiast can
-- change a copy they received. A trainer can read an Enthusiast's own workouts
-- and tracking only while share_with_trainer is on and the link is active.

alter table public.profiles
  add column if not exists share_with_trainer boolean not null default true;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists messages_thread_idx
  on public.messages (trainer_id, client_id, created_at);

create index if not exists messages_unread_idx
  on public.messages (trainer_id, client_id)
  where read_at is null;

create table if not exists public.member_workouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  source_trainer_id uuid references public.profiles (id),
  source_workout_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_workouts_name_len check (char_length(name) between 1 and 120)
);

create index if not exists member_workouts_owner_idx
  on public.member_workouts (owner_id);

create unique index if not exists member_workouts_local_idx
  on public.member_workouts (owner_id, local_id)
  where local_id is not null;

create table if not exists public.training_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id text not null,
  workout_id text,
  workout_name text,
  started_at timestamptz,
  ended_at timestamptz,
  results jsonb not null default '[]'::jsonb,
  unique (owner_id, local_id)
);

create index if not exists training_logs_owner_idx
  on public.training_logs (owner_id, ended_at desc);

create index if not exists trainer_clients_trainer_active_idx
  on public.trainer_clients (trainer_id)
  where ended_at is null;

alter table public.messages enable row level security;
alter table public.member_workouts enable row level security;
alter table public.training_logs enable row level security;

revoke all on public.messages from public, anon, authenticated;
revoke all on public.member_workouts from public, anon, authenticated;
revoke all on public.training_logs from public, anon, authenticated;
grant select on public.messages to authenticated;
grant select on public.member_workouts to authenticated;
grant select on public.training_logs to authenticated;

-- True when these two profiles have a live trainer/client link.
create or replace function public.coaching_linked(p_trainer uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trainer_clients
    where trainer_id = p_trainer and client_id = p_client and ended_at is null
  );
$$;

create or replace function public.coaching_is_enthusiast(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_id
      and (membership = 'enthusiast' or intended_plan = 'enthusiast')
  );
$$;

-- Trainer may read this client's own rows only while the link is active,
-- the client is an Enthusiast, and they have left sharing on.
create or replace function public.coaching_can_view(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.coaching_linked(auth.uid(), p_client)
    and public.coaching_is_enthusiast(p_client)
    and coalesce((select share_with_trainer from public.profiles where id = p_client), false);
$$;

-- The caller's active pair. Trainers pass the client id. Clients ignore it.
create or replace function public.coaching_pair(p_person uuid)
returns table (trainer uuid, client uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
begin
  if uid is null then return; end if;
  select * into me from public.profiles where id = uid;
  if not found then return; end if;
  if public.invite_role(me) is not null then
    if p_person is null or not public.coaching_linked(uid, p_person) then return; end if;
    trainer := uid;
    client := p_person;
    return next;
    return;
  end if;
  select link.trainer_id, link.client_id into trainer, client
  from public.trainer_clients link
  where link.client_id = uid and link.ended_at is null
  limit 1;
  if found then return next; end if;
end;
$$;

create or replace function public.guard_member_workout()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  enthusiast boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    new.updated_at = now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from auth.uid() then
      if new.source_trainer_id is distinct from auth.uid()
         or not public.coaching_linked(auth.uid(), new.owner_id) then
        raise exception 'You can only send a workout to a linked client.';
      end if;
    end if;
    new.updated_at = now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.source_trainer_id is not null and old.owner_id = auth.uid()
       and not public.coaching_is_enthusiast(auth.uid()) then
      raise exception 'Only an Enthusiast can edit a workout from a trainer.';
    end if;
    return old;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.source_trainer_id is distinct from old.source_trainer_id
     or new.local_id is distinct from old.local_id then
    raise exception 'That workout cannot be reassigned.';
  end if;
  if old.source_trainer_id is not null and old.owner_id = auth.uid() then
    enthusiast := public.coaching_is_enthusiast(auth.uid());
    if not enthusiast then
      raise exception 'Only an Enthusiast can edit a workout from a trainer.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists member_workouts_guard on public.member_workouts;
create trigger member_workouts_guard
  before insert or update or delete on public.member_workouts
  for each row execute function public.guard_member_workout();

create or replace function public.coaching_in_live_thread(p_trainer uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() in (p_trainer, p_client)
    and public.coaching_linked(p_trainer, p_client);
$$;

drop policy if exists messages_select_live on public.messages;
create policy messages_select_live
  on public.messages
  for select
  to authenticated
  using ((select public.coaching_in_live_thread(trainer_id, client_id)));

drop policy if exists member_workouts_owner_read on public.member_workouts;
create policy member_workouts_owner_read
  on public.member_workouts
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

-- A trainer reads the Enthusiast's own workouts (not copies the trainer sent)
-- only while the share flag is on and the link is still active.
drop policy if exists member_workouts_trainer_read on public.member_workouts;
create policy member_workouts_trainer_read
  on public.member_workouts
  for select
  to authenticated
  using (
    source_trainer_id is null
    and owner_id <> (select auth.uid())
    and (select public.coaching_can_view(owner_id))
  );

drop policy if exists training_logs_owner_read on public.training_logs;
create policy training_logs_owner_read
  on public.training_logs
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists training_logs_trainer_read on public.training_logs;
create policy training_logs_trainer_read
  on public.training_logs
  for select
  to authenticated
  using (
    owner_id <> (select auth.uid())
    and (select public.coaching_can_view(owner_id))
  );

create or replace function public.coaching_set_share(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not public.coaching_is_enthusiast(uid) then
    raise exception 'Only an Enthusiast can share workouts and tracking.';
  end if;
  update public.profiles set share_with_trainer = coalesce(p_on, true) where id = uid;
  return jsonb_build_object('on', coalesce(p_on, true));
end;
$$;

create or replace function public.coaching_share()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  on_flag boolean;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select share_with_trainer into on_flag from public.profiles where id = uid;
  return jsonb_build_object(
    'on', coalesce(on_flag, true),
    'enthusiast', public.coaching_is_enthusiast(uid)
  );
end;
$$;

create or replace function public.coaching_threads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  if public.invite_role(me) is not null then
    return jsonb_build_object(
      'role', 'trainer',
      'threads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.client_id,
          'name', coalesce(p.email, 'Client'),
          'plan', case when p.membership = 'enthusiast' or p.intended_plan = 'enthusiast' then 'Enthusiast' else 'Free Client' end,
          'preview', lm.body,
          'at', lm.created_at,
          'unread', (
            select count(*)::int from public.messages m
            where m.trainer_id = uid and m.client_id = c.client_id
              and m.sender_id <> uid and m.read_at is null
          )
        ) order by lm.created_at desc nulls last, p.email)
        from public.trainer_clients c
        join public.profiles p on p.id = c.client_id
        left join lateral (
          select body, created_at from public.messages
          where trainer_id = uid and client_id = c.client_id
          order by created_at desc
          limit 1
        ) lm on true
        where c.trainer_id = uid and c.ended_at is null
      ), '[]'::jsonb)
    );
  end if;
  return jsonb_build_object(
    'role', 'client',
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', link.trainer_id,
        'name', coalesce(trainer.email, 'Trainer'),
        'plan', 'Trainer',
        'preview', lm.body,
        'at', lm.created_at,
        'unread', (
          select count(*)::int from public.messages m
          where m.trainer_id = link.trainer_id and m.client_id = uid
            and m.sender_id <> uid and m.read_at is null
        )
      ))
      from public.trainer_clients link
      join public.profiles trainer on trainer.id = link.trainer_id
      left join lateral (
        select body, created_at from public.messages
        where trainer_id = link.trainer_id and client_id = uid
        order by created_at desc
        limit 1
      ) lm on true
      where link.client_id = uid and link.ended_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.coaching_messages(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair record;
  person public.profiles;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into pair from public.coaching_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  select * into person from public.profiles
    where id = case when pair.trainer = uid then pair.client else pair.trainer end;
  return jsonb_build_object(
    'person', jsonb_build_object(
      'id', person.id,
      'name', coalesce(person.email, 'Linked'),
      'plan', case
        when pair.trainer = uid and (person.membership = 'enthusiast' or person.intended_plan = 'enthusiast') then 'Enthusiast'
        when pair.trainer = uid then 'Free Client'
        else 'Trainer'
      end
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'senderId', m.sender_id,
        'mine', m.sender_id = uid,
        'body', m.body,
        'at', m.created_at,
        'readAt', m.read_at
      ) order by m.created_at)
      from (
        select * from public.messages
        where trainer_id = pair.trainer and client_id = pair.client
        order by created_at desc
        limit 200
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.coaching_send_message(p_person uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair record;
  clean text := trim(coalesce(p_body, ''));
  created public.messages;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if char_length(clean) < 1 or char_length(clean) > 2000 then
    raise exception 'Enter a message.';
  end if;
  select * into pair from public.coaching_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  insert into public.messages (trainer_id, client_id, sender_id, body)
  values (pair.trainer, pair.client, uid, clean)
  returning * into created;
  return jsonb_build_object(
    'id', created.id,
    'senderId', created.sender_id,
    'mine', true,
    'body', created.body,
    'at', created.created_at
  );
end;
$$;

create or replace function public.coaching_mark_read(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair record;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into pair from public.coaching_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
  update public.messages
    set read_at = now()
    where trainer_id = pair.trainer and client_id = pair.client
      and sender_id <> uid and read_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.coaching_send_workout(
  p_clients uuid[],
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
  clean_name text := trim(coalesce(p_name, ''));
  client_id uuid;
  created_id uuid;
  sent jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if public.invite_role(me) is null then
    raise exception 'Only a trainer can send a workout.';
  end if;
  if clean_name = '' or char_length(clean_name) > 120 then
    raise exception 'Enter a workout name.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200
     or octet_length(p_items::text) > 500000 then
    raise exception 'That workout could not be sent.';
  end if;
  if p_clients is null or cardinality(p_clients) < 1 or cardinality(p_clients) > 30 then
    raise exception 'Choose a linked client.';
  end if;
  foreach client_id in array p_clients loop
    if not public.coaching_linked(uid, client_id) then
      raise exception 'Choose a linked client.';
    end if;
    insert into public.member_workouts (owner_id, name, items, source_trainer_id, source_workout_id)
    values (client_id, clean_name, p_items, uid, nullif(trim(coalesce(p_source, '')), ''))
    returning id into created_id;
    sent := sent || jsonb_build_array(jsonb_build_object(
      'clientId', client_id,
      'workoutId', created_id
    ));
  end loop;
  return jsonb_build_object('name', clean_name, 'sent', sent);
end;
$$;

create or replace function public.coaching_my_workouts()
returns jsonb
language plpgsql
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
      'sourceTrainerId', w.source_trainer_id,
      'sourceTrainerEmail', trainer.email,
      'sourceWorkoutId', w.source_workout_id,
      'updatedAt', w.updated_at
    ) order by w.created_at desc)
    from public.member_workouts w
    left join public.profiles trainer on trainer.id = w.source_trainer_id
    where w.owner_id = uid
      and w.source_trainer_id is not null
      and public.coaching_linked(w.source_trainer_id, uid)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.coaching_save_copy(p_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(p_name, ''));
  row public.member_workouts;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not public.coaching_is_enthusiast(uid) then
    raise exception 'Only an Enthusiast can edit a workout from a trainer.';
  end if;
  if clean_name = '' or char_length(clean_name) > 120 then
    raise exception 'Enter a workout name.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'That workout could not be saved.';
  end if;
  update public.member_workouts
    set name = clean_name, items = p_items
    where id = p_id and owner_id = uid and source_trainer_id is not null
    returning * into row;
  if not found then raise exception 'That copy was not found.'; end if;
  return jsonb_build_object('id', row.id, 'name', row.name, 'updatedAt', row.updated_at);
end;
$$;

create or replace function public.coaching_push_own(p_workouts jsonb, p_logs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  local text;
  wname text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not public.coaching_is_enthusiast(uid) then
    return jsonb_build_object('ok', false);
  end if;
  if jsonb_typeof(p_workouts) is distinct from 'array' then p_workouts := '[]'::jsonb; end if;
  if jsonb_typeof(p_logs) is distinct from 'array' then p_logs := '[]'::jsonb; end if;
  for item in select value from jsonb_array_elements(p_workouts) loop
    local := nullif(trim(coalesce(item->>'localId', '')), '');
    wname := trim(coalesce(item->>'name', ''));
    if local is null or wname = '' or char_length(wname) > 120 then continue; end if;
    if jsonb_typeof(item->'items') is distinct from 'array' then continue; end if;
    insert into public.member_workouts (owner_id, local_id, name, items, source_trainer_id)
    values (uid, local, wname, item->'items', null)
    on conflict (owner_id, local_id) where local_id is not null
    do update set name = excluded.name, items = excluded.items, updated_at = now();
  end loop;
  delete from public.member_workouts w
    where w.owner_id = uid and w.source_trainer_id is null and w.local_id is not null
      and not exists (
        select 1 from jsonb_array_elements(p_workouts) e
        where nullif(trim(coalesce(e.value->>'localId', '')), '') = w.local_id
      );
  for item in select value from jsonb_array_elements(p_logs) loop
    local := nullif(trim(coalesce(item->>'localId', '')), '');
    if local is null then continue; end if;
    begin
      insert into public.training_logs (owner_id, local_id, workout_id, workout_name, started_at, ended_at, results)
      values (
        uid,
        local,
        nullif(item->>'workoutId', ''),
        nullif(item->>'workoutName', ''),
        case
          when coalesce(item->>'startedAt', '') ~ '^[0-9]+$' then to_timestamp((item->>'startedAt')::double precision / 1000)
          else nullif(item->>'startedAt', '')::timestamptz
        end,
        case
          when coalesce(item->>'endedAt', '') ~ '^[0-9]+$' then to_timestamp((item->>'endedAt')::double precision / 1000)
          else nullif(item->>'endedAt', '')::timestamptz
        end,
        case when jsonb_typeof(item->'results') = 'array' then item->'results' else '[]'::jsonb end
      )
      on conflict (owner_id, local_id) do update set
        workout_name = excluded.workout_name,
        ended_at = excluded.ended_at,
        results = excluded.results;
    exception when others then
      null;
    end;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.coaching_client_view(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  client public.profiles;
  shared boolean;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if public.invite_role(me) is null then
    raise exception 'Only a trainer can view a client.';
  end if;
  if not public.coaching_linked(uid, p_client) then
    raise exception 'There is no connection.';
  end if;
  select * into client from public.profiles where id = p_client;
  shared := public.coaching_is_enthusiast(p_client) and coalesce(client.share_with_trainer, false);
  if not shared then
    return jsonb_build_object(
      'shared', false,
      'email', client.email,
      'plan', case when public.coaching_is_enthusiast(p_client) then 'Enthusiast' else 'Free Client' end,
      'workouts', '[]'::jsonb,
      'logs', '[]'::jsonb
    );
  end if;
  return jsonb_build_object(
    'shared', true,
    'email', client.email,
    'plan', 'Enthusiast',
    'workouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'name', w.name,
        'exerciseCount', jsonb_array_length(w.items),
        'updatedAt', w.updated_at
      ) order by w.updated_at desc)
      from public.member_workouts w
      where w.owner_id = p_client and w.source_trainer_id is null
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workoutName', l.workout_name,
        'endedAt', l.ended_at
      ) order by l.ended_at desc nulls last)
      from (
        select workout_name, ended_at from public.training_logs
        where owner_id = p_client
        order by ended_at desc nulls last
        limit 30
      ) l
    ), '[]'::jsonb)
  );
end;
$$;

-- Redeem keeps its old behavior and, for an Enthusiast, stores the sharing choice.
drop function if exists public.invite_redeem(text);

create or replace function public.invite_redeem(p_code text, p_share boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if uid is null then raise exception 'Sign in first.'; end if;
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
    raise exception 'That invite code was not found.';
  end if;
  select * into inv from public.invites where code = norm for update;
  if not found then raise exception 'That invite code was not found.'; end if;
  if inv.used_at is not null then raise exception 'That invite has already been used.'; end if;
  if inv.canceled_at is not null then raise exception 'That invite was canceled.'; end if;
  if inv.expires_at <= now() then raise exception 'That invite has expired.'; end if;
  perform pg_advisory_xact_lock(hashtext(inv.trainer_id::text));
  select * into trainer from public.profiles where id = inv.trainer_id;
  cap := public.invite_cap(public.invite_role(trainer));
  select count(*) into active_clients from public.trainer_clients
    where trainer_id = inv.trainer_id and ended_at is null;
  if active_clients >= cap then
    raise exception 'That trainer has no open client spots.';
  end if;
  enthusiast := me.membership = 'enthusiast' or me.intended_plan = 'enthusiast';
  if not enthusiast and me.membership is distinct from 'free_client' then
    perform set_config('app.invite_redeem', 'on', true);
    update public.profiles set membership = 'free_client' where id = uid;
  end if;
  if enthusiast then
    update public.profiles set share_with_trainer = coalesce(p_share, true) where id = uid;
  end if;
  update public.invites set used_at = now(), used_by = uid where id = inv.id;
  insert into public.trainer_clients (trainer_id, client_id) values (inv.trainer_id, uid);
  if enthusiast then
    return jsonb_build_object(
      'message', 'You are connected. Your Enthusiast plan is unchanged.',
      'trainer_id', inv.trainer_id,
      'trainerId', inv.trainer_id
    );
  end if;
  return jsonb_build_object(
    'message', 'You are connected as a Free Client.',
    'trainer_id', inv.trainer_id,
    'trainerId', inv.trainer_id
  );
end;
$$;

revoke all on function public.coaching_in_live_thread(uuid, uuid) from public, anon, authenticated;
revoke all on function public.coaching_can_view(uuid) from public, anon, authenticated;
revoke all on function public.coaching_linked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.coaching_is_enthusiast(uuid) from public, anon, authenticated;
revoke all on function public.coaching_pair(uuid) from public, anon, authenticated;
revoke all on function public.guard_member_workout() from public, anon, authenticated;

revoke all on function public.coaching_set_share(boolean) from public, anon, authenticated;
revoke all on function public.coaching_share() from public, anon, authenticated;
revoke all on function public.coaching_threads() from public, anon, authenticated;
revoke all on function public.coaching_messages(uuid) from public, anon, authenticated;
revoke all on function public.coaching_send_message(uuid, text) from public, anon, authenticated;
revoke all on function public.coaching_mark_read(uuid) from public, anon, authenticated;
revoke all on function public.coaching_send_workout(uuid[], text, jsonb, text) from public, anon, authenticated;
revoke all on function public.coaching_my_workouts() from public, anon, authenticated;
revoke all on function public.coaching_save_copy(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.coaching_push_own(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.coaching_client_view(uuid) from public, anon, authenticated;
revoke all on function public.invite_redeem(text, boolean) from public, anon;

grant execute on function public.coaching_in_live_thread(uuid, uuid) to authenticated;
grant execute on function public.coaching_can_view(uuid) to authenticated;
grant execute on function public.coaching_set_share(boolean) to authenticated;
grant execute on function public.coaching_share() to authenticated;
grant execute on function public.coaching_threads() to authenticated;
grant execute on function public.coaching_messages(uuid) to authenticated;
grant execute on function public.coaching_send_message(uuid, text) to authenticated;
grant execute on function public.coaching_mark_read(uuid) to authenticated;
grant execute on function public.coaching_send_workout(uuid[], text, jsonb, text) to authenticated;
grant execute on function public.coaching_my_workouts() to authenticated;
grant execute on function public.coaching_save_copy(uuid, text, jsonb) to authenticated;
grant execute on function public.coaching_push_own(jsonb, jsonb) to authenticated;
grant execute on function public.coaching_client_view(uuid) to authenticated;
grant execute on function public.invite_redeem(text, boolean) to authenticated;

do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$pub$;

notify pgrst, 'reload schema';
