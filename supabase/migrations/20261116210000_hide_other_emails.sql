-- Other people's email addresses stay in the database.
-- Apply once in the Supabase SQL editor AFTER 20261116180000_share_inbox_any_client.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
--
-- A signed-in person can still read their own profiles.email.
-- The admin verification queue still includes the applicant's email.
-- Everyone else gets a display name, or Client, Trainer, or Enthusiast.
-- A saved name that itself contains @ is treated as not a name.
--
-- The calendar Edge Function does not build titles. It prints the title
-- this file's calendar_feed_for_token already returns, so that function
-- does not need a new deploy.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

-- Display name when it is not an email address. Otherwise the role label.
create or replace function private.shown_name(raw text, fallback text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(raw), '') is not null
     and position('@' in btrim(raw)) = 0
    then btrim(raw)
    else fallback
  end;
$$;

revoke all on function private.shown_name(text, text) from public, anon, authenticated;

-- Rows saved before this file still have the trainer's email in trainer_name.
update public.shared_dashboards d
set trainer_name = coalesce(
  (
    select private.shown_name(p.display_name, 'Trainer')
    from public.profiles p
    where p.id = d.trainer_id
  ),
  'Trainer'
)
where position('@' in d.trainer_name) > 0;

-- Same checks as 20261116150000_shared_dashboards.sql.
-- An email-looking trainer name is replaced before the row is stored.
create or replace function private.shared_dashboard_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  seen text[] := '{}';
  kind text;
begin
  if tg_op = 'INSERT' and position('@' in btrim(coalesce(new.trainer_name, ''))) > 0 then
    select private.shown_name(p.display_name, 'Trainer')
      into new.trainer_name
    from public.profiles p
    where p.id = new.trainer_id;
    if new.trainer_name is null
       or position('@' in new.trainer_name) > 0
       or char_length(btrim(new.trainer_name)) < 1 then
      new.trainer_name := 'Trainer';
    end if;
  end if;

  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A shared dashboard is kept.';
  end if;

  if tg_op = 'INSERT' then
    if new.trainer_id is distinct from auth.uid() then
      raise exception 'You share a dashboard as yourself.';
    end if;
    if not private.tracking_trainer_of(new.client_id) then
      raise exception 'You can share a dashboard only with a connected client.';
    end if;
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and membership in ('trainer', 'master_trainer')
    ) then
      raise exception 'Only a trainer can share a dashboard.';
    end if;
    if not private.share_inbox(new.client_id) then
      raise exception 'A shared dashboard goes to a free client.';
    end if;
    if new.viewed_at is not null then
      raise exception 'A new dashboard has not been opened.';
    end if;
    new.trainer_name := btrim(coalesce(new.trainer_name, ''));
    if char_length(new.trainer_name) < 1 or char_length(new.trainer_name) > 80 then
      raise exception 'Enter the trainer name.';
    end if;
    if position('@' in new.trainer_name) > 0 then
      new.trainer_name := 'Trainer';
    end if;
    if new.as_of is null then
      raise exception 'A dashboard needs a date.';
    end if;
    if new.cards is null
       or jsonb_typeof(new.cards) is distinct from 'array'
       or jsonb_array_length(new.cards) < 1
       or jsonb_array_length(new.cards) > 6
       or octet_length(new.cards::text) > 200000 then
      raise exception 'Choose the cards to share.';
    end if;
    for item in select value from jsonb_array_elements(new.cards) loop
      kind := item->>'type';
      if kind is null or kind not in ('plan', 'workouts', 'volume', 'records', 'calendar', 'pass') then
        raise exception 'Choose the cards to share.';
      end if;
      if kind = any (seen) then
        raise exception 'Each card is shared once.';
      end if;
      seen := seen || kind;
    end loop;
    new.created_at := now();
    return new;
  end if;

  if auth.uid() is distinct from old.client_id then
    raise exception 'Only the client can open this dashboard.';
  end if;
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.trainer_id is distinct from old.trainer_id
     or new.trainer_name is distinct from old.trainer_name
     or new.as_of is distinct from old.as_of
     or new.cards is distinct from old.cards
     or new.created_at is distinct from old.created_at then
    raise exception 'A shared dashboard cannot be changed.';
  end if;
  if old.viewed_at is not null then
    raise exception 'This dashboard was already opened.';
  end if;
  if new.viewed_at is null then
    raise exception 'Opening a dashboard marks it viewed.';
  end if;
  return new;
end;
$$;

revoke all on function private.shared_dashboard_guard() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shared_dashboards_name_no_at'
      and conrelid = 'public.shared_dashboards'::regclass
  ) then
    alter table public.shared_dashboards
      add constraint shared_dashboards_name_no_at
      check (position('@' in trainer_name) = 0);
  end if;
end $$;

-- Same roster as 20261116150000_shared_dashboards.sql, without each client's email.
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
        'name', private.shown_name(
          p.display_name,
          case
            when p.membership = 'enthusiast' or p.intended_plan = 'enthusiast' then 'Enthusiast'
            else 'Client'
          end
        ),
        'avatarPath', p.avatar_path,
        'membership', p.membership,
        'plan', case when p.membership = 'enthusiast' or p.intended_plan = 'enthusiast' then 'Enthusiast' else 'Free Client' end
      ) order by private.shown_name(
        p.display_name,
        case
          when p.membership = 'enthusiast' or p.intended_plan = 'enthusiast' then 'Enthusiast'
          else 'Client'
        end
      ))
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

-- Same link as 20261115140000_master_trainer_verification.sql, without trainerEmail.
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
    'trainerName', private.shown_name(trainer.display_name, 'Trainer'),
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

-- The name column used to be called email. Callers use it only as a label.
drop function if exists public.message_pair(uuid);
drop function if exists public.message_roster();

create function public.message_roster()
returns table (
  person_id uuid,
  name text,
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
    private.shown_name(
      p.display_name,
      case
        when c.trainer_id = auth.uid()
         and (p.membership = 'enthusiast' or p.intended_plan = 'enthusiast') then 'Enthusiast'
        when c.trainer_id = auth.uid() then 'Client'
        else 'Trainer'
      end
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

create function public.message_pair(p_person uuid)
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

revoke all on function public.message_roster() from public, anon, authenticated;
revoke all on function public.message_pair(uuid) from public, anon, authenticated;
grant execute on function public.message_roster() to authenticated;
grant execute on function public.message_pair(uuid) to authenticated;

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
        'name', r.name,
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
    'name', r.name,
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

-- Same status as 20261115002700_profile_details.sql, without the client's email.
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
    'name', private.shown_name(client.display_name, case when enthusiast then 'Enthusiast' else 'Client' end),
    'avatarPath', client.avatar_path,
    'plan', case when enthusiast then 'Enthusiast' else 'Free Client' end
  );
end;
$$;

-- Same copies as 20261115140000_master_trainer_verification.sql, without sourceTrainerEmail.
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
      'sourceTrainerName', private.shown_name(p.display_name, 'your trainer'),
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

-- Same feed as 20261112150000_calendar_feeds.sql.
-- A client title is the workout name plus a display name or Client/Enthusiast.
-- The part before @ is not a name.
create or replace function public.calendar_feed_for_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  feed public.calendar_feeds;
  v_user uuid;
  v_zone text;
  v_trainer boolean;
  events jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into feed
  from public.calendar_feeds
  where token = p_token;

  if not found then
    return null;
  end if;

  v_user := feed.user_id;
  v_zone := feed.time_zone;
  v_trainer := public.program_is_trainer(v_user);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'day', s.day,
      'start', s.start_at,
      'end', s.end_at,
      'updated', s.updated
    )
    order by s.day, s.start_at nulls last, s.id
  ), '[]'::jsonb)
  into events
  from (
    select
      e.id::text as id,
      e.workout_name as title,
      to_char(e.day, 'YYYY-MM-DD') as day,
      to_char(e.starts_at, 'HH24:MI') as start_at,
      to_char(e.ends_at, 'HH24:MI') as end_at,
      to_char(e.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated
    from public.program_entries e
    where e.owner_id = v_user

    union all

    select
      e.id::text,
      e.workout_name || ' ' || chr(8211) || ' ' || private.shown_name(
        c.display_name,
        case
          when c.membership = 'enthusiast' or c.intended_plan = 'enthusiast' then 'Enthusiast'
          else 'Client'
        end
      ),
      to_char(e.day, 'YYYY-MM-DD'),
      to_char(e.starts_at, 'HH24:MI'),
      to_char(e.ends_at, 'HH24:MI'),
      to_char(e.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    from public.program_entries e
    join public.profiles c on c.id = e.owner_id
    where v_trainer
      and e.owner_id <> v_user
      and e.presence = 'trainer'
      and public.program_linked(v_user, e.owner_id)
      and (
        not public.share_is_enthusiast(e.owner_id)
        or coalesce(c.share_with_trainer, false)
      )
  ) s;

  return jsonb_build_object(
    'timezone', v_zone,
    'events', events
  );
end;
$$;

-- profiles stays readable only by the person who owns the row.
-- That is how a person still reads their own email. A connected trainer
-- or client does not get a second select policy on this table.
do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policy
    where polrelid = 'public.profiles'::regclass
      and polcmd in ('r', '*')
      and polname <> 'profiles_select_own'
  loop
    execute format('drop policy %I on public.profiles', pol.polname);
  end loop;
end $$;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

notify pgrst, 'reload schema';
