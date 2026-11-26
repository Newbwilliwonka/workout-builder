-- No past-due access. A failed renewal or a deleted subscription ends the
-- paid plan immediately. profiles.plan_ended_at marks that moment. A new
-- paid plan clears it. Fourteen days later, a daily job deletes that
-- account's data and leaves the profile in place as a no-plan user.
--
-- Apply once in the Supabase SQL editor AFTER
-- 20261125235000_service_role_billing_grants.sql, together with the
-- stripe-webhook deploy. Do not run this from the app.
-- Safe to run again. It does not clear an existing plan_ended_at.
--
-- What changes
--   There is no past-due membership. past_due and unpaid end the paid plan
--   and are stored as canceled. A linked payer becomes membership none,
--   not Free Client. Free Client accounts are not changed.
--   plan_ended_at is set once, when a paid plan becomes none, and is not
--   moved if the end is recorded again. grant, and a sync onto an active
--   or trialing paid plan, clear it.
--   The signed-in person still cannot write plan_ended_at.
--
-- Data hold
--   private.purge_ended_plan_data() deletes the rows of accounts whose
--   plan_ended_at is older than 14 days and whose membership is still none.
--   It never selects a Free Client, and it never deletes auth.users or the
--   profile row. Workout sessions, sets, and typed-in exercises go in the
--   same order as public.tracking_clear_client(), then the other rows an
--   account delete would cascade. Active trainer_clients links are ended
--   (ended_at), the same write as invite_end, so a linked client stays and
--   becomes unlinked. Messages on that thread are removed with the ended
--   account, the same as an account delete.
--
-- Schedule
--   When pg_cron is available, the job purge-ended-plan-data runs at
--   04:15 UTC every day. The function is not granted to the API roles.

alter table public.profiles
  add column if not exists plan_ended_at timestamptz;

comment on column public.profiles.plan_ended_at is
  'When the last paid plan ended. Cleared when a paid plan starts again. Empty when this account has not had a paid plan end.';

create index if not exists profiles_plan_ended_none_idx
  on public.profiles (plan_ended_at)
  where plan_ended_at is not null
    and membership = 'none';

create or replace function private.lock_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null
       and (
         new.stripe_customer_id is not null
         or new.stripe_subscription_id is not null
         or new.billing_status is not null
         or new.current_period_end is not null
         or new.plan_ended_at is not null
         or coalesce(new.beta_locked, false)
         or coalesce(new.complimentary, false)
       ) then
      raise exception 'Billing changes require payment.';
    end if;
    return new;
  end if;

  if auth.uid() is not null
     and (
       new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.billing_status is distinct from old.billing_status
       or new.current_period_end is distinct from old.current_period_end
       or new.plan_ended_at is distinct from old.plan_ended_at
       or new.beta_locked is distinct from old.beta_locked
       or new.complimentary is distinct from old.complimentary
     ) then
    raise exception 'Billing changes require payment.';
  end if;
  return new;
end;
$fn$;

revoke all on function private.lock_billing_columns() from public, anon, authenticated;
grant execute on function private.lock_billing_columns() to authenticated;

create or replace function public.apply_stripe_membership(
  p_profile uuid,
  p_action text,
  p_plan text default null,
  p_billing_status text default null,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_period_end timestamptz default null,
  p_checkout_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_plan text := nullif(lower(btrim(coalesce(p_plan, ''))), '');
  v_status text := nullif(lower(btrim(coalesce(p_billing_status, ''))), '');
  v_customer text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_subscription text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_row public.profiles;
  v_membership text;
  v_period timestamptz;
  v_plan_ended timestamptz;
  v_downgrade boolean := false;
  v_clear_hold boolean := false;
  v_clear_intended boolean := false;
  v_newly boolean := false;
  v_confirm jsonb;
begin
  perform private.billing_service_only();
  perform set_config('request.jwt.claim.sub', '', true);

  if p_profile is null then
    raise exception 'That account was not found.';
  end if;
  if v_action not in ('attach', 'grant', 'past_due', 'sync', 'end') then
    raise exception 'That billing action is not valid.';
  end if;
  if v_plan is not null and v_plan not in ('enthusiast', 'trainer', 'master_trainer') then
    raise exception 'Choose Enthusiast, Trainer, or Master Trainer.';
  end if;
  if v_status is not null
     and v_status not in ('incomplete', 'active', 'past_due', 'unpaid', 'canceled') then
    raise exception 'That billing status is not valid.';
  end if;
  if v_customer is not null
     and (v_customer !~ '^cus_[A-Za-z0-9]+$' or char_length(v_customer) > 255) then
    raise exception 'That customer id is not valid.';
  end if;
  if v_subscription is not null
     and (v_subscription !~ '^sub_[A-Za-z0-9]+$' or char_length(v_subscription) > 255) then
    raise exception 'That subscription id is not valid.';
  end if;

  if v_action = 'grant' then
    if v_plan is null then
      raise exception 'Choose Enthusiast, Trainer, or Master Trainer.';
    end if;
    v_status := 'active';
  elsif v_action = 'past_due' then
    v_plan := null;
  end if;

  select * into v_row
  from public.profiles
  where id = p_profile
  for update;

  if not found then
    raise exception 'That account was not found.';
  end if;

  if v_action in ('past_due', 'sync', 'end')
     and v_subscription is not null
     and v_row.stripe_subscription_id is not null
     and v_subscription is distinct from v_row.stripe_subscription_id then
    return jsonb_build_object(
      'applied', false,
      'newly_ended', false,
      'membership', v_row.membership,
      'billing_status', v_row.billing_status,
      'beta_locked', v_row.beta_locked,
      'complimentary', v_row.complimentary,
      'current_period_end', v_row.current_period_end,
      'plan_ended_at', v_row.plan_ended_at,
      'stripe_customer_id', v_row.stripe_customer_id,
      'stripe_subscription_id', v_row.stripe_subscription_id
    );
  end if;

  v_membership := v_row.membership;
  v_period := coalesce(p_period_end, v_row.current_period_end);
  v_plan_ended := v_row.plan_ended_at;
  if v_status is null then
    v_status := v_row.billing_status;
  end if;

  -- A caller that still sends past_due ends the plan. There is no past-due access.
  if v_action = 'past_due' then
    v_action := 'end';
    v_status := 'canceled';
    v_period := now();
  end if;

  if v_action = 'grant' then
    v_membership := v_plan;
    v_status := 'active';
    v_clear_hold := true;
  elsif v_action = 'sync' then
    if v_status in ('past_due', 'unpaid') then
      v_status := 'canceled';
      v_downgrade := true;
    elsif v_plan is not null and v_status = 'active' then
      v_membership := v_plan;
      v_clear_hold := true;
    end if;
    if v_status = 'canceled' and (v_period is null or v_period <= now()) then
      v_downgrade := true;
    end if;
  elsif v_action = 'end' then
    if v_status is null or v_status not in ('canceled', 'unpaid') then
      v_status := 'canceled';
    end if;
    if v_status = 'unpaid' then
      v_status := 'canceled';
    end if;
    if v_period is null or v_period <= now() then
      if v_row.complimentary
         and v_row.stripe_subscription_id is null
         and v_subscription is null then
        v_status := v_row.billing_status;
      else
        v_downgrade := true;
      end if;
    end if;
  end if;

  if v_downgrade and v_membership in ('enthusiast', 'trainer', 'master_trainer') then
    v_membership := 'none';
    v_clear_intended := true;
    if v_row.plan_ended_at is null then
      v_plan_ended := now();
      v_newly := true;
    else
      v_plan_ended := v_row.plan_ended_at;
    end if;
  elsif v_clear_hold and v_membership in ('enthusiast', 'trainer', 'master_trainer') then
    v_plan_ended := null;
  end if;

  if v_customer is not null and exists (
    select 1 from public.profiles p
    where p.stripe_customer_id = v_customer
      and p.id <> p_profile
  ) then
    raise exception 'That Stripe customer is already linked to another account.';
  end if;
  if v_subscription is not null and exists (
    select 1 from public.profiles p
    where p.stripe_subscription_id = v_subscription
      and p.id <> p_profile
  ) then
    raise exception 'That Stripe subscription is already linked to another account.';
  end if;

  update public.profiles
    set membership = v_membership,
        intended_plan = case when v_clear_intended then null else intended_plan end,
        stripe_customer_id = coalesce(v_customer, stripe_customer_id),
        stripe_subscription_id = coalesce(v_subscription, stripe_subscription_id),
        billing_status = v_status,
        current_period_end = v_period,
        plan_ended_at = v_plan_ended
    where id = p_profile;

  if v_action = 'grant'
     or (v_action = 'sync' and v_status = 'active' and not v_downgrade) then
    v_confirm := public.beta_reservation_confirm(p_profile, p_checkout_session_id);
  end if;

  select * into v_row from public.profiles where id = p_profile;
  return jsonb_build_object(
    'applied', true,
    'newly_ended', v_newly,
    'membership', v_row.membership,
    'billing_status', v_row.billing_status,
    'beta_locked', v_row.beta_locked,
    'complimentary', v_row.complimentary,
    'current_period_end', v_row.current_period_end,
    'plan_ended_at', v_row.plan_ended_at,
    'stripe_customer_id', v_row.stripe_customer_id,
    'stripe_subscription_id', v_row.stripe_subscription_id,
    'beta_confirm', v_confirm
  );
end;
$fn$;

-- A different active or trialing subscription is left in place. past_due is
-- not a live plan, so a new subscription can replace it.
create or replace function public.billing_write(
  p_profile uuid,
  p_action text,
  p_plan text default null,
  p_billing_status text default null,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_period_end timestamptz default null,
  p_beta boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_subscription text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_row public.profiles;
  v_result jsonb;
begin
  perform private.billing_service_only();
  perform set_config('request.jwt.claim.sub', '', true);
  if p_profile is null then
    raise exception 'That account was not found.';
  end if;

  select * into v_row
  from public.profiles
  where id = p_profile
  for update;

  if not found then
    raise exception 'That account was not found.';
  end if;

  if v_action in ('grant', 'attach', 'sync')
     and v_subscription is not null
     and v_row.stripe_subscription_id is not null
     and v_subscription is distinct from v_row.stripe_subscription_id
     and v_row.billing_status in ('active', 'trialing') then
    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'kept_subscription_id', v_row.stripe_subscription_id,
      'incoming_subscription_id', v_subscription
    );
  end if;

  v_result := public.apply_stripe_membership(
    p_profile,
    v_action,
    p_plan,
    p_billing_status,
    p_customer_id,
    v_subscription,
    p_period_end,
    null
  );
  if v_action = 'grant' and p_beta is true then
    perform public.mark_beta_paid(p_profile);
  end if;
  return v_result || jsonb_build_object('duplicate', false);
end;
$fn$;

create or replace function public.keep_paid_subscription(
  p_profile uuid,
  p_subscription_id text,
  p_replace_id text,
  p_plan text default null,
  p_customer_id text default null,
  p_period_end timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_keep text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_replace text := nullif(btrim(coalesce(p_replace_id, '')), '');
  v_plan text := nullif(lower(btrim(coalesce(p_plan, ''))), '');
  v_customer text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_row public.profiles;
begin
  perform private.billing_service_only();
  perform set_config('request.jwt.claim.sub', '', true);
  if p_profile is null or v_keep is null or v_replace is null then
    raise exception 'That account was not found.';
  end if;
  if v_keep !~ '^sub_[A-Za-z0-9]+$' or v_replace !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'That subscription id is not valid.';
  end if;
  if v_plan is not null and v_plan not in ('enthusiast', 'trainer', 'master_trainer') then
    raise exception 'Choose Enthusiast, Trainer, or Master Trainer.';
  end if;

  select * into v_row
  from public.profiles
  where id = p_profile
  for update;

  if not found then
    raise exception 'That account was not found.';
  end if;
  if v_row.stripe_subscription_id = v_keep then
    return jsonb_build_object('applied', true);
  end if;
  if v_row.stripe_subscription_id is distinct from v_replace then
    return jsonb_build_object('applied', false);
  end if;

  update public.profiles
    set stripe_subscription_id = v_keep,
        stripe_customer_id = coalesce(v_customer, stripe_customer_id),
        membership = coalesce(v_plan, membership),
        billing_status = 'active',
        current_period_end = coalesce(p_period_end, current_period_end),
        plan_ended_at = case
          when coalesce(v_plan, membership) in ('enthusiast', 'trainer', 'master_trainer') then null
          else plan_ended_at
        end
  where id = p_profile
    and stripe_subscription_id = v_replace;

  return jsonb_build_object('applied', true);
end;
$fn$;

-- Deletes one ended account's data. The profile row stays.
-- Sessions, then sets, then typed-in exercises, then shared dashboards:
-- the same order as public.tracking_clear_client().
create or replace function private.purge_ended_account(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.profiles;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  if auth.uid() is not null then
    raise exception 'This cleanup does not run for a signed-in session.';
  end if;
  if p_profile is null then
    return;
  end if;

  select * into v_row
  from public.profiles
  where id = p_profile
  for update;

  if not found then
    return;
  end if;
  if v_row.membership is distinct from 'none' then
    return;
  end if;
  if v_row.membership = 'free_client' then
    return;
  end if;
  if v_row.plan_ended_at is null or v_row.plan_ended_at >= now() - interval '14 days' then
    return;
  end if;

  -- Unlink, the same column invite_end writes. Do not delete the other account.
  update public.trainer_clients
    set ended_at = now()
  where ended_at is null
    and (trainer_id = p_profile or client_id = p_profile);

  delete from public.workout_sessions where client_id = p_profile;
  delete from public.workout_sets where client_id = p_profile;
  delete from public.personal_exercises where user_id = p_profile;
  delete from public.shared_dashboards
    where client_id = p_profile or trainer_id = p_profile;

  delete from public.circuit_placement_invites
    where trainer_id = p_profile or client_id = p_profile;
  delete from public.program_entries where owner_id = p_profile;
  delete from public.messages
    where trainer_id = p_profile or client_id = p_profile or sender_id = p_profile;
  delete from public.workout_copies
    where owner_id = p_profile or trainer_id = p_profile;
  delete from public.own_sessions where owner_id = p_profile;
  delete from public.own_workouts where owner_id = p_profile;
  delete from public.account_workout_imports where owner_id = p_profile;
  delete from public.account_workouts where owner_id = p_profile;
  delete from public.calendar_feeds where user_id = p_profile;
  delete from public.dashboard_layouts where user_id = p_profile;
  delete from public.client_info where user_id = p_profile;
  delete from public.nav_seen where user_id = p_profile;
  delete from public.feedback where user_id = p_profile;
  delete from public.verification_requests where user_id = p_profile;
  delete from public.hub_posts where author_id = p_profile;
  delete from public.hub_replies where author_id = p_profile;
  delete from public.hub_reports where reporter_id = p_profile;
  delete from private.hub_events where user_id = p_profile;
  delete from public.circuits where owner_id = p_profile;
  delete from public.circuit_runs where trainer_id = p_profile;
  delete from public.trainer_requests
    where trainer_id = p_profile or client_id = p_profile;
  delete from public.trainer_temp_links
    where trainer_id = p_profile or client_id = p_profile;
  delete from public.invites where trainer_id = p_profile;
  delete from public.beta_reservations where profile_id = p_profile;
  delete from private.trainer_locations where trainer_id = p_profile;
  delete from private.client_locations where client_id = p_profile;

  update public.profiles
    set plan_ended_at = null,
        listed = false,
        checkout_claim_until = null,
        checkout_claim_plan = null,
        checkout_claim_token = null
  where id = p_profile
    and membership = 'none';
end;
$fn$;

create or replace function private.purge_ended_plan_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_n integer := 0;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  if auth.uid() is not null then
    raise exception 'This cleanup does not run for a signed-in session.';
  end if;

  for v_id in
    select p.id
    from public.profiles p
    where p.plan_ended_at is not null
      and p.plan_ended_at < now() - interval '14 days'
      and p.membership = 'none'
      and p.membership is distinct from 'free_client'
    order by p.plan_ended_at
  loop
    perform private.purge_ended_account(v_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

comment on function private.purge_ended_plan_data() is
  'Deletes data for no-plan accounts whose plan_ended_at is older than 14 days. Keeps the profile. Skips Free Clients. Ends trainer links instead of deleting the other account.';

revoke all on function private.purge_ended_account(uuid) from public;
revoke all on function private.purge_ended_plan_data() from public;

do $revoke$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.purge_ended_account(uuid) from anon;
    revoke all on function private.purge_ended_plan_data() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.purge_ended_account(uuid) from authenticated;
    revoke all on function private.purge_ended_plan_data() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function private.purge_ended_account(uuid) from service_role;
    revoke all on function private.purge_ended_plan_data() from service_role;
  end if;
end
$revoke$;

do $cron$
declare
  v_job bigint;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not installed. Schedule select private.purge_ended_plan_data() daily after enabling it.';
    return;
  end if;
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception
    when others then
      raise notice 'pg_cron was not enabled: %', sqlerrm;
      return;
  end;
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron did not create the cron schema.';
    return;
  end if;
  for v_job in
    select j.jobid
    from cron.job j
    where j.jobname = 'purge-ended-plan-data'
  loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule(
    'purge-ended-plan-data',
    '15 4 * * *',
    $job$select private.purge_ended_plan_data()$job$
  );
end
$cron$;

notify pgrst, 'reload schema';
