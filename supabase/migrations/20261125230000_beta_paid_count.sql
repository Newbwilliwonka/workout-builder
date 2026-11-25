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

revoke all on function public.beta_paid_count() from public, anon, authenticated;
revoke all on function public.mark_beta_paid(uuid) from public, anon, authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.beta_paid_count() to service_role;
    grant execute on function public.mark_beta_paid(uuid) to service_role;
  end if;
end
$service$;

notify pgrst, 'reload schema';
