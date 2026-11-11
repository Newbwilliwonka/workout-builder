-- Messages between a trainer and each linked client.
-- Apply once in the Supabase SQL editor AFTER 20261107160000_invites.sql
-- (later exercise migrations do not have to be undone):
--   Dashboard → SQL → New query → paste this file → Run.
--
-- Do not put a service-role key in the app. Nothing here changes invites,
-- workouts, or the player. Ending a connection still uses invite_end.
-- While that link is ended, these two people cannot read or write the
-- thread, and it disappears from their list. The rows stay in the table.
--
-- Safe to run again: the table is created only if missing, functions are
-- replaced, and policies are dropped before they are recreated.

create table if not exists public.messages (
  id uuid primary key,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_body_len check (char_length(body) between 1 and 2000),
  constraint messages_sender_pair check (sender_id = trainer_id or sender_id = client_id)
);

create index if not exists messages_thread_idx
  on public.messages (trainer_id, client_id, created_at desc, id desc);

create index if not exists messages_unread_idx
  on public.messages (trainer_id, client_id)
  where read_at is null;

alter table public.messages replica identity full;

alter table public.messages enable row level security;

revoke all on public.messages from public, anon, authenticated;
grant select, insert, update on public.messages to authenticated;

-- True only for the two people on a link that has not ended.
create or replace function public.message_live(p_trainer uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and auth.uid() in (p_trainer, p_client)
    and exists (
      select 1 from public.trainer_clients
      where trainer_id = p_trainer
        and client_id = p_client
        and ended_at is null
    );
$$;

-- The signed-in person's active links, with the other person's email and plan.
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

create or replace function public.message_pair(p_person uuid)
returns table (trainer uuid, client uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.trainer_id, r.client_id
  from public.message_roster() r
  where p_person is not null
    and r.person_id = p_person
  limit 1;
$$;

-- Inserts may only add the caller's own unread message.
-- Updates may only mark someone else's message read. The body cannot change.
create or replace function public.message_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.sender_id is distinct from auth.uid() then
      raise exception 'You can only send as yourself.';
    end if;
    new.read_at := null;
    if auth.uid() is not null then
      new.created_at := now();
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
    if auth.uid() is not null and auth.uid() = old.sender_id then
      raise exception 'You cannot mark your own message read.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'Messages cannot be deleted.';
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard
  before insert or update or delete on public.messages
  for each row execute function public.message_guard();

drop policy if exists messages_select_live on public.messages;
create policy messages_select_live
  on public.messages
  for select
  to authenticated
  using ((select public.message_live(trainer_id, client_id)));

drop policy if exists messages_insert_live on public.messages;
create policy messages_insert_live
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and read_at is null
    and (select public.message_live(trainer_id, client_id))
  );

drop policy if exists messages_update_read on public.messages;
create policy messages_update_read
  on public.messages
  for update
  to authenticated
  using (
    sender_id <> (select auth.uid())
    and (select public.message_live(trainer_id, client_id))
  )
  with check (
    sender_id <> (select auth.uid())
    and (select public.message_live(trainer_id, client_id))
  );

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
  -- Same rule as invite_role, inlined so this does not depend on that function's grants.
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
  select jsonb_build_object('id', r.person_id, 'name', r.email, 'plan', r.plan)
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

-- p_id is chosen by the sender. A retry of the same id cannot insert a second row.
create or replace function public.message_send(p_person uuid, p_id uuid, p_body text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair record;
  clean text := btrim(coalesce(p_body, ''));
  created public.messages;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_id is null then raise exception 'Could not send that message.'; end if;
  if char_length(clean) < 1 or char_length(clean) > 2000 then
    raise exception 'Enter a message.';
  end if;
  select * into pair from public.message_pair(p_person);
  if not found then raise exception 'There is no connection.'; end if;
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
$$;

create or replace function public.message_read(p_person uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair record;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
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
$$;

revoke all on function public.message_live(uuid, uuid) from public, anon, authenticated;
revoke all on function public.message_roster() from public, anon, authenticated;
revoke all on function public.message_pair(uuid) from public, anon, authenticated;
revoke all on function public.message_guard() from public, anon, authenticated;
revoke all on function public.message_threads() from public, anon, authenticated;
revoke all on function public.message_open(uuid) from public, anon, authenticated;
revoke all on function public.message_send(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.message_read(uuid) from public, anon, authenticated;

grant execute on function public.message_live(uuid, uuid) to authenticated;
grant execute on function public.message_roster() to authenticated;
grant execute on function public.message_pair(uuid) to authenticated;
grant execute on function public.message_guard() to authenticated;
grant execute on function public.message_threads() to authenticated;
grant execute on function public.message_open(uuid) to authenticated;
grant execute on function public.message_send(uuid, uuid, text) to authenticated;
grant execute on function public.message_read(uuid) to authenticated;

do $pub$
begin
  if exists (
    select 1 from pg_publication
    where pubname = 'supabase_realtime' and not puballtables
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$pub$;

notify pgrst, 'reload schema';
