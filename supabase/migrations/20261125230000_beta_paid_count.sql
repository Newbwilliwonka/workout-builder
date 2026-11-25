-- Paid Beta count. Checkout reads it. A seat is counted when payment
-- sets beta_locked, not while Checkout is open. A few extra Beta prices
-- past 100 are acceptable.
-- Apply once in the Supabase SQL editor AFTER 20261125200000_stripe_billing.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Safe to run again. It does not change the billing tables from that file.

create or replace function public.beta_paid_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  perform private.billing_service_only();
  select count(*)::integer into v_count
  from public.profiles
  where beta_locked;
  return coalesce(v_count, 0);
end;
$fn$;

create or replace function public.mark_beta_paid(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform private.billing_service_only();
  -- The membership trigger allows a billing write when no one is signed in
  -- on this statement. The caller check above already ran.
  perform set_config('request.jwt.claim.sub', '', true);
  if p_profile is null then
    raise exception 'That account was not found.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'That account was not found.';
  end if;
  update public.profiles
    set beta_locked = true
  where id = p_profile
    and beta_locked is distinct from true;
end;
$fn$;

-- One Checkout create at a time per person. The claim is a short timestamp,
-- not a Beta seat. The row lock makes the second request see the first claim.
alter table public.profiles
  add column if not exists checkout_claim_until timestamptz;

comment on column public.profiles.checkout_claim_until is
  'Service role only. While this is in the future, another Checkout create for this profile should reuse the open session.';

create or replace function public.checkout_claim(p_profile uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_until timestamptz;
  v_plan text := lower(btrim(coalesce(p_plan, '')));
begin
  perform private.billing_service_only();
  perform set_config('request.jwt.claim.sub', '', true);
  if p_profile is null then
    raise exception 'That account was not found.';
  end if;
  if v_plan not in ('enthusiast', 'trainer', 'master_trainer') then
    raise exception 'Choose Enthusiast, Trainer, or Master Trainer.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('checkout:' || p_profile::text, 0));

  select p.checkout_claim_until
    into v_until
  from public.profiles p
  where p.id = p_profile
  for update;

  if not found then
    raise exception 'That account was not found.';
  end if;

  if v_until is not null and v_until > now() then
    return jsonb_build_object('granted', false);
  end if;

  update public.profiles
    set checkout_claim_until = now() + interval '45 seconds'
  where id = p_profile;

  return jsonb_build_object('granted', true);
end;
$fn$;

-- Grant, attach, or sync under a row lock. A different subscription that is
-- still active is left in place and reported. The webhook cancels the newer one.
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
     and v_row.billing_status in ('active', 'trialing', 'past_due') then
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

-- Point the profile at the older subscription after a duplicate payment.
-- It only replaces the subscription id the caller names.
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
        current_period_end = coalesce(p_period_end, current_period_end)
  where id = p_profile
    and stripe_subscription_id = v_replace;

  return jsonb_build_object('applied', true);
end;
$fn$;

revoke all on function public.beta_paid_count() from public, anon, authenticated;
revoke all on function public.mark_beta_paid(uuid) from public, anon, authenticated;
revoke all on function public.checkout_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_write(uuid, text, text, text, text, text, timestamp with time zone, boolean) from public, anon, authenticated;
revoke all on function public.keep_paid_subscription(uuid, text, text, text, text, timestamp with time zone) from public, anon, authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.beta_paid_count() to service_role;
    grant execute on function public.mark_beta_paid(uuid) to service_role;
    grant execute on function public.checkout_claim(uuid, text) to service_role;
    grant execute on function public.billing_write(uuid, text, text, text, text, text, timestamp with time zone, boolean) to service_role;
    grant execute on function public.keep_paid_subscription(uuid, text, text, text, text, timestamp with time zone) to service_role;
    grant update (checkout_claim_until) on table public.profiles to service_role;
  end if;
end
$service$;

notify pgrst, 'reload schema';
