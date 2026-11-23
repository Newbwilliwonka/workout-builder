-- Link a client to a trainer at sign-up, before an admin approves the account.
-- Apply once in the Supabase SQL editor AFTER 20261123010000_tracking_can_read.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Safe to run again. Do not deploy an Edge Function for this file.
--
-- What changes
--   invite_redeem no longer waits for access approval. Approval still blocks
--   the rest of the app. A new account can be linked while it shows
--   Waiting for access, so a 24-hour code is not lost to a slow approval.
--   Sign-up stores the code in the auth user's raw_user_meta_data as
--   invite_code. The new-user trigger reads that and links immediately,
--   including when the person still has to confirm their email on another
--   device. A bad code does not block creating the account.
--   Repeating a code this person already used, while that link is still
--   open, returns the same success. It does not show an error.
--   The result has no email. One person still cannot see another's address.

create or replace function public.invite_attach(p_user uuid, p_code text, p_share boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me public.profiles;
  inv public.invites;
  trainer public.profiles;
  norm text;
  existing uuid;
  active_clients int;
  cap int;
  enthusiast boolean;
  invite_found boolean := false;
  generic text := 'That invite could not be used.';
begin
  if p_user is null then raise exception 'Sign in first.' using hint = 'invite_sign_in'; end if;
  select * into me from public.profiles where id = p_user;
  if not found then raise exception 'Sign in first.' using hint = 'invite_sign_in'; end if;
  norm := public.invite_norm(p_code);
  if norm !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception '%', generic using hint = 'invite_invalid';
  end if;
  select * into inv from public.invites where code = norm for update;
  invite_found := found;
  if invite_found and inv.used_by = p_user and exists (
    select 1 from public.trainer_clients c
    where c.client_id = p_user
      and c.trainer_id = inv.trainer_id
      and c.ended_at is null
  ) then
    enthusiast := coalesce(me.membership, '') = 'enthusiast'
      or coalesce(me.intended_plan, '') = 'enthusiast';
    if enthusiast then
      return jsonb_build_object(
        'message', 'You are connected. Your Enthusiast plan is unchanged.',
        'trainer_id', inv.trainer_id,
        'membership', me.membership
      );
    end if;
    return jsonb_build_object(
      'message', 'You are connected as a Free Client.',
      'trainer_id', inv.trainer_id,
      'membership', me.membership
    );
  end if;
  if public.invite_role(me) is not null then
    raise exception 'A Trainer or Master Trainer cannot join as a client.' using hint = 'invite_trainer';
  end if;
  select id into existing from public.trainer_clients
    where client_id = p_user and ended_at is null limit 1;
  if existing is not null then
    raise exception 'You are already connected to a trainer. End that connection before using a new invite.' using hint = 'invite_connected';
  end if;
  if not invite_found then
    raise exception '%', generic using hint = 'invite_invalid';
  end if;
  if inv.canceled_at is not null then
    raise exception '%', generic using hint = 'invite_canceled';
  end if;
  if inv.used_at is not null then
    raise exception '%', generic using hint = 'invite_used';
  end if;
  if inv.expires_at <= now() then
    raise exception '%', generic using hint = 'invite_expired';
  end if;
  perform pg_advisory_xact_lock(hashtext(inv.trainer_id::text));
  select * into trainer from public.profiles where id = inv.trainer_id;
  cap := public.invite_cap(public.invite_role(trainer));
  select count(*) into active_clients from public.trainer_clients
    where trainer_id = inv.trainer_id and ended_at is null;
  if active_clients >= cap then
    raise exception '%', generic using hint = 'invite_full';
  end if;
  enthusiast := coalesce(me.membership, '') = 'enthusiast'
    or coalesce(me.intended_plan, '') = 'enthusiast';
  if not enthusiast and me.membership is distinct from 'free_client' then
    perform set_config('app.invite_redeem', 'on', true);
    update public.profiles set membership = 'free_client' where id = p_user;
    me.membership := 'free_client';
  end if;
  if enthusiast then
    update public.profiles
      set share_with_trainer = case when p_share is null then true else p_share end
      where id = p_user;
  end if;
  update public.invites set used_at = now(), used_by = p_user where id = inv.id;
  insert into public.trainer_clients (trainer_id, client_id) values (inv.trainer_id, p_user);
  perform set_config('app.temp_convert', 'on', true);
  update public.trainer_temp_links
    set converted_at = now()
    where trainer_id = inv.trainer_id
      and client_id = p_user
      and ended_at is null
      and converted_at is null;
  perform set_config('app.temp_convert', 'off', true);
  perform set_config('app.request_close', 'on', true);
  update public.trainer_requests
    set status = 'closed'
    where trainer_id = inv.trainer_id
      and client_id = p_user
      and status = 'open';
  perform set_config('app.request_close', 'off', true);
  if enthusiast then
    return jsonb_build_object(
      'message', 'You are connected. Your Enthusiast plan is unchanged.',
      'trainer_id', inv.trainer_id,
      'membership', me.membership
    );
  end if;
  return jsonb_build_object(
    'message', 'You are connected as a Free Client.',
    'trainer_id', inv.trainer_id,
    'membership', me.membership
  );
end;
$fn$;

revoke all on function public.invite_attach(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.invite_redeem(p_code text, p_share boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.' using hint = 'invite_sign_in'; end if;
  return public.invite_attach(uid, p_code, p_share);
end;
$fn$;

revoke all on function public.invite_redeem(text, boolean) from public, anon;
grant execute on function public.invite_redeem(text, boolean) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  meta jsonb;
  code text := '';
begin
  -- The auth service inserts this row. Ignore any signed-in id on the
  -- connection so the new profile is not rejected as someone else's.
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.profiles (id, email, membership)
  values (new.id, new.email, 'none')
  on conflict (id) do nothing;
  begin
    meta := to_jsonb(new);
    code := public.invite_norm(coalesce(meta -> 'raw_user_meta_data' ->> 'invite_code', ''));
  exception when others then
    code := '';
  end;
  if code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    begin
      perform public.invite_attach(new.id, code, true);
    exception when others then
      -- Keep the account. The code stays on the auth user for the first sign-in.
      null;
    end;
  end if;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

notify pgrst, 'reload schema';
