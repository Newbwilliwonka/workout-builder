-- Beta holds last 35 minutes.
-- Apply once in the Supabase SQL editor AFTER 20261125200000_stripe_billing.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Safe to run again. It only replaces beta_reservation_hold.
--
-- Stripe Checkout cannot expire sooner than 30 minutes. The hold used to
-- last 30 minutes too, so a person could still pay the Beta price after the
-- seat had been released. A new hold now lasts 35 minutes. Checkout is set
-- to end at 31 minutes, before the hold. Confirmed seats are unchanged.

create or replace function public.beta_reservation_hold(p_profile uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_locked boolean;
  v_count integer;
  v_limit integer;
  v_holds integer;
  v_id uuid;
  v_expires timestamptz;
  v_existing_plan text;
begin
  perform private.billing_service_only();
  if p_profile is null then
    raise exception 'That account was not found.';
  end if;
  if v_plan not in ('enthusiast', 'trainer', 'master_trainer') then
    raise exception 'Choose Enthusiast, Trainer, or Master Trainer.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'That account was not found.';
  end if;
  if not private.is_approved(p_profile) then
    raise exception 'Checkout opens after an admin approves the account.';
  end if;

  select s.confirmed_count, s.cohort_limit
    into v_count, v_limit
  from public.beta_cohort_state s
  where s.id
  for update;

  update public.beta_reservations
    set status = 'released',
        released_at = now()
    where status = 'held'
      and expires_at <= now();

  select p.beta_locked into v_locked
  from public.profiles p
  where p.id = p_profile;

  if v_locked then
    return jsonb_build_object(
      'cohort', 'beta',
      'reservation_id', null,
      'beta_locked', true
    );
  end if;

  select r.id, r.expires_at, r.plan
    into v_id, v_expires, v_existing_plan
  from public.beta_reservations r
  where r.profile_id = p_profile
    and r.status = 'held'
    and r.expires_at > now()
  for update;

  if v_id is not null then
    if v_existing_plan is distinct from v_plan then
      update public.beta_reservations
        set plan = v_plan
        where id = v_id;
    end if;
    return jsonb_build_object(
      'cohort', 'beta',
      'reservation_id', v_id,
      'beta_locked', false,
      'expires_at', v_expires
    );
  end if;

  select count(*) into v_holds
  from public.beta_reservations r
  where r.status = 'held'
    and r.expires_at > now();

  if v_count + v_holds >= v_limit then
    return jsonb_build_object(
      'cohort', 'standard',
      'reservation_id', null,
      'beta_locked', false
    );
  end if;

  insert into public.beta_reservations (profile_id, plan, status, expires_at)
  values (p_profile, v_plan, 'held', now() + interval '35 minutes')
  returning id, expires_at into v_id, v_expires;

  return jsonb_build_object(
    'cohort', 'beta',
    'reservation_id', v_id,
    'beta_locked', false,
    'expires_at', v_expires
  );
end;
$fn$;
