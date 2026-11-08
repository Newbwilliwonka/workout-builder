-- Trainer invite keys and client connections.
-- Apply in the Supabase SQL editor AFTER 20261106150000_profiles.sql.
-- Dashboard → SQL → New query → paste this file → Run.
-- Do not put a service-role key in the app. The site only calls the functions below.
--
-- A Trainer or Master Trainer (membership, or the saved intended_plan until payments
-- exist) creates one invite at a time. Open unused invites plus current clients
-- cannot pass the cap (15 or 30). An unused invite lasts 24 hours. Redeeming a
-- valid key attaches the signed-in person to that trainer. A person with no paid
-- plan becomes Free Client. An Enthusiast stays an Enthusiast. Ending the
-- connection frees the slot and does not remove the client's plan.

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles (id),
  canceled_at timestamptz
);

create table if not exists public.trainer_clients (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists trainer_clients_one_active
  on public.trainer_clients (client_id)
  where ended_at is null;

alter table public.invites enable row level security;
alter table public.trainer_clients enable row level security;

revoke all on public.invites from public, anon, authenticated;
revoke all on public.trainer_clients from public, anon, authenticated;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
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
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.invite_role(p public.profiles)
returns text
language sql
stable
as $$
  select case
    when p.membership in ('trainer', 'master_trainer') then p.membership
    when p.intended_plan in ('trainer', 'master_trainer') then p.intended_plan
    else null
  end;
$$;

create or replace function public.invite_cap(role text)
returns int
language sql
immutable
as $$
  select case role when 'master_trainer' then 30 when 'trainer' then 15 else 0 end;
$$;

create or replace function public.invite_make_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

create or replace function public.invite_norm(raw text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(raw, ''), '[\s-]', '', 'g'));
$$;

create or replace function public.invite_create()
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
  used int;
  fresh text;
  guard int := 0;
  created public.invites;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into me from public.profiles where id = uid;
  if not found then raise exception 'Sign in first.'; end if;
  role := public.invite_role(me);
  cap := public.invite_cap(role);
  if cap = 0 then raise exception 'Only a Trainer or Master Trainer can create invites.'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select
    (select count(*) from public.trainer_clients where trainer_id = uid and ended_at is null) +
    (select count(*) from public.invites where trainer_id = uid and used_at is null and canceled_at is null and expires_at > now())
  into used;
  if used >= cap then raise exception 'No invite slots left.'; end if;
  loop
    fresh := public.invite_make_code();
    exit when not exists (select 1 from public.invites where code = fresh);
    guard := guard + 1;
    if guard > 20 then raise exception 'Could not create an invite code.'; end if;
  end loop;
  insert into public.invites (trainer_id, code, expires_at)
  values (uid, fresh, now() + interval '24 hours')
  returning * into created;
  return jsonb_build_object('code', created.code, 'expires_at', created.expires_at);
end;
$$;

create or replace function public.invite_cancel(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv public.invites;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select * into inv from public.invites
    where code = public.invite_norm(p_code) and trainer_id = uid
    for update;
  if not found or inv.used_at is not null or inv.canceled_at is not null then
    raise exception 'That invite cannot be canceled.';
  end if;
  update public.invites set canceled_at = now() where id = inv.id;
  return jsonb_build_object('code', inv.code);
end;
$$;

create or replace function public.invite_redeem(p_code text)
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
  update public.invites set used_at = now(), used_by = uid where id = inv.id;
  insert into public.trainer_clients (trainer_id, client_id) values (inv.trainer_id, uid);
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
$$;

create or replace function public.invite_end(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  link public.trainer_clients;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_client is null then
    select * into link from public.trainer_clients
      where client_id = uid and ended_at is null
      for update;
  else
    select * into link from public.trainer_clients
      where trainer_id = uid and client_id = p_client and ended_at is null
      for update;
  end if;
  if not found then raise exception 'There is no connection to end.'; end if;
  update public.trainer_clients set ended_at = now() where id = link.id;
  return jsonb_build_object('trainer_id', link.trainer_id, 'message', 'Connection ended.');
end;
$$;

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
        'plan', case when p.membership = 'enthusiast' or p.intended_plan = 'enthusiast' then 'Enthusiast' else 'Free Client' end
      ) order by p.email)
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
  return jsonb_build_object('trainerId', link.trainer_id, 'trainerEmail', trainer.email);
end;
$$;

grant execute on function public.invite_create() to authenticated;
grant execute on function public.invite_cancel(text) to authenticated;
grant execute on function public.invite_redeem(text) to authenticated;
grant execute on function public.invite_end(uuid) to authenticated;
grant execute on function public.invite_roster() to authenticated;
grant execute on function public.invite_mine() to authenticated;
