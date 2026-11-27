-- A Customer Portal cancel sets cancel_at to the period end. The subscription
-- stays active until then. profiles.cancel_at stores that moment so Account
-- can say when the plan ends. Null means the subscription renews.

alter table public.profiles
  add column if not exists cancel_at timestamptz;

comment on column public.profiles.cancel_at is
  'When the paid subscription is set to end. Null while it renews.';

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
         or new.cancel_at is not null
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
       or new.cancel_at is distinct from old.cancel_at
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

-- Service role only. A null p_cancel_at clears a pending cancel. A different
-- subscription id does not change this account's date.
create or replace function public.set_subscription_cancel(
  p_profile uuid,
  p_subscription_id text,
  p_cancel_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_subscription text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_row public.profiles;
begin
  perform private.billing_service_only();
  perform set_config('request.jwt.claim.sub', '', true);

  if p_profile is null then
    raise exception 'That account was not found.';
  end if;
  if v_subscription is null
     or v_subscription !~ '^sub_[A-Za-z0-9]+$'
     or char_length(v_subscription) > 255 then
    raise exception 'That subscription id is not valid.';
  end if;

  select * into v_row
  from public.profiles
  where id = p_profile
  for update;

  if not found then
    raise exception 'That account was not found.';
  end if;
  if v_row.stripe_subscription_id is distinct from v_subscription then
    return jsonb_build_object('applied', false, 'cancel_at', v_row.cancel_at);
  end if;

  update public.profiles
    set cancel_at = p_cancel_at
    where id = p_profile;

  return jsonb_build_object('applied', true, 'cancel_at', p_cancel_at);
end;
$fn$;

revoke all on function public.set_subscription_cancel(uuid, text, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.set_subscription_cancel(uuid, text, timestamp with time zone) to service_role;
