-- Stripe billing columns, the first-100 Beta counter, and the membership
-- update a later webhook will call.
-- Apply once in the Supabase SQL editor AFTER 20261125180000_feedback.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function. No Stripe keys.
-- Safe to run again. A second run does not reset the Beta count and does
-- not mark anyone new as complimentary.
--
-- What a signed-in person can still change
--   Name, photo, bio, city, state, listing, sharing, and the plan they
--   intend to buy. The same profile save as today.
-- What they cannot change
--   stripe_customer_id, stripe_subscription_id, billing_status,
--   current_period_end, beta_locked, or complimentary. Table update is
--   limited to the older columns, and a trigger blocks those six even if
--   a later grant is broader.
--
-- Prices William confirmed on 25 November 2026
--   The first 100 paid subscribers are locked for life:
--     Enthusiast $9.99 / month
--     Trainer $19.99 / month
--     Master Trainer $29.99 / month
--   Person 101 onward uses a separate standard price. The standard amounts
--   are the same numbers for now, so a later raise does not move the first
--   100. A person with beta_locked who switches plan keeps the Beta price
--   of the new plan. This file does not create Stripe products or prices.
--   It only decides whether a checkout is Beta or standard.
--
-- Early testers
--   The first time this file runs, every account that already has
--   Enthusiast, Trainer, or Master Trainer is marked complimentary.
--   They keep that access without a Stripe subscription. Free Client is
--   not complimentary. Accounts created later are not marked.
--
-- Checkout
--   beta_reservation_hold refuses an account an admin has not approved.
--
-- Cancel and failed payment
--   Access lasts through current_period_end. After that, a person with a
--   live trainer link becomes Free Client. Otherwise the membership is
--   none. past_due keeps the paid membership. Complimentary accounts that
--   never had a Stripe subscription are left as they are.
--
-- Who can call the new functions
--   service_role only: apply_stripe_membership, beta_reservation_hold,
--   beta_reservation_attach, beta_reservation_confirm,
--   beta_reservation_release, beta_reservation_release_expired,
--   and stripe_event_begin. anon and authenticated are revoked.
--   A signed-in JWT is rejected inside the function as well.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists beta_locked boolean not null default false,
  add column if not exists complimentary boolean not null default false;

comment on column public.profiles.stripe_customer_id is
  'Stripe customer id. Only the billing function writes it.';
comment on column public.profiles.stripe_subscription_id is
  'Stripe subscription id. Only the billing function writes it.';
comment on column public.profiles.billing_status is
  'incomplete, active, past_due, unpaid, or canceled. Empty when this account has never been billed.';
comment on column public.profiles.current_period_end is
  'Paid access lasts until this time. Empty when there is no paid period.';
comment on column public.profiles.beta_locked is
  'True for one of the first 100 paid subscribers. A later plan change stays on the Beta price. Cancel does not clear it.';
comment on column public.profiles.complimentary is
  'True for early testers who already had a paid membership when billing was added. They keep that access without Stripe.';

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_stripe_customer_id_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_stripe_customer_id_check
      check (
        stripe_customer_id is null
        or (
          char_length(stripe_customer_id) between 5 and 255
          and stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_stripe_subscription_id_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_stripe_subscription_id_check
      check (
        stripe_subscription_id is null
        or (
          char_length(stripe_subscription_id) between 5 and 255
          and stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_billing_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_billing_status_check
      check (
        billing_status is null
        or billing_status in ('incomplete', 'active', 'past_due', 'unpaid', 'canceled')
      );
  end if;
end
$constraints$;

create unique index if not exists profiles_stripe_customer_id_uidx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_uidx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Signed-in writes cannot set billing columns. The database owner and the
-- billing function (which clears the signed-in id for that statement) can.
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
       or new.beta_locked is distinct from old.beta_locked
       or new.complimentary is distinct from old.complimentary
     ) then
    raise exception 'Billing changes require payment.';
  end if;
  return new;
end;
$fn$;

revoke all on function private.lock_billing_columns() from public, anon;
grant execute on function private.lock_billing_columns() to authenticated;

drop trigger if exists profiles_lock_billing on public.profiles;
create trigger profiles_lock_billing
  before insert or update on public.profiles
  for each row execute function private.lock_billing_columns();

-- Column privileges are the first guard. The trigger above is the second,
-- for a security-definer update made while someone is signed in.
-- updated_at and created_at stay off this list; the existing profile
-- trigger still stamps updated_at.
revoke update, insert on table public.profiles from public, anon, authenticated;

grant update (
  email,
  membership,
  intended_plan,
  share_with_trainer,
  display_name,
  city,
  state,
  online_only,
  bio,
  avatar_path,
  verified_until,
  access_approved,
  listed,
  service_type
) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  membership,
  intended_plan
) on table public.profiles to authenticated;

-- One row. confirmed_count is paid Beta subscribers, not holds and not
-- Free Clients. The limit stays 100.
create table if not exists public.beta_cohort_state (
  id boolean primary key default true,
  confirmed_count integer not null default 0,
  cohort_limit integer not null default 100,
  constraint beta_cohort_state_one check (id),
  constraint beta_cohort_state_limit check (cohort_limit = 100),
  constraint beta_cohort_state_count check (
    confirmed_count >= 0 and confirmed_count <= cohort_limit
  )
);

comment on table public.beta_cohort_state is
  'Single row. How many of the first 100 Beta memberships are confirmed. Clients cannot read or write it.';

insert into public.beta_cohort_state (id, confirmed_count, cohort_limit)
values (true, 0, 100)
on conflict (id) do nothing;

-- A hold lasts 30 minutes so an abandoned checkout does not keep a slot.
-- Confirming a hold still counts if it has not been released yet.
create table if not exists public.beta_reservations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  checkout_session_id text,
  plan text not null,
  status text not null default 'held',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  released_at timestamptz,
  constraint beta_reservations_status_check check (status in ('held', 'confirmed', 'released')),
  constraint beta_reservations_plan_check check (plan in ('enthusiast', 'trainer', 'master_trainer')),
  constraint beta_reservations_session_check check (
    checkout_session_id is null
    or (
      char_length(checkout_session_id) between 5 and 255
      and checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    )
  )
);

comment on table public.beta_reservations is
  'Beta checkout holds. held, confirmed, or released. Clients cannot read or write it.';

create index if not exists beta_reservations_profile_idx
  on public.beta_reservations (profile_id);

create unique index if not exists beta_reservations_one_hold
  on public.beta_reservations (profile_id)
  where status = 'held';

create unique index if not exists beta_reservations_session_uidx
  on public.beta_reservations (checkout_session_id)
  where checkout_session_id is not null;

create index if not exists beta_reservations_held_expires_idx
  on public.beta_reservations (expires_at)
  where status = 'held';

-- Webhook idempotency. The event id is the primary key. No payload is stored.
create table if not exists public.stripe_events (
  id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  constraint stripe_events_id_check check (
    char_length(id) between 5 and 255
    and id ~ '^evt_[A-Za-z0-9]+$'
  ),
  constraint stripe_events_type_check check (
    char_length(event_type) between 1 and 120
    and event_type ~ '^[a-z0-9_.]+$'
  )
);

comment on table public.stripe_events is
  'Stripe event ids already accepted. A duplicate insert means the webhook already ran. Clients cannot read or write it.';

alter table public.beta_cohort_state enable row level security;
alter table public.beta_reservations enable row level security;
alter table public.stripe_events enable row level security;

revoke all on table public.beta_cohort_state from public, anon, authenticated;
revoke all on table public.beta_reservations from public, anon, authenticated;
revoke all on table public.stripe_events from public, anon, authenticated;

drop policy if exists beta_cohort_state_no_client on public.beta_cohort_state;
create policy beta_cohort_state_no_client
  on public.beta_cohort_state
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists beta_reservations_no_client on public.beta_reservations;
create policy beta_reservations_no_client
  on public.beta_reservations
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists stripe_events_no_client on public.stripe_events;
create policy stripe_events_no_client
  on public.stripe_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- One-time complimentary mark. A later run must not flag people who
-- become Trainer after this, including people who pay through Stripe.
create table if not exists private.billing_grandfather (
  done boolean primary key default true,
  done_at timestamptz not null default now(),
  constraint billing_grandfather_one check (done)
);

comment on table private.billing_grandfather is
  'Remembers that early paid memberships were marked complimentary once.';

alter table private.billing_grandfather enable row level security;
revoke all on table private.billing_grandfather from public, anon, authenticated;

do $backfill$
begin
  if not exists (select 1 from private.billing_grandfather) then
    update public.profiles
      set complimentary = true
      where membership in ('enthusiast', 'trainer', 'master_trainer');
    insert into private.billing_grandfather (done) values (true);
  end if;
end
$backfill$;

create or replace function private.billing_service_only()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  if v_role = '' and v_claims <> '' then
    begin
      v_role := coalesce(v_claims::jsonb ->> 'role', '');
    exception
      when others then
        v_role := '';
    end;
  end if;
  if v_role in ('anon', 'authenticated') then
    raise exception 'Billing changes are not available here.';
  end if;
  if v_role is distinct from 'service_role'
     and session_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Billing changes are not available here.';
  end if;
end;
$fn$;

revoke all on function private.billing_service_only() from public, anon, authenticated;

create or replace function public.stripe_event_begin(p_event_id text, p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_event_id, '')), '');
  v_type text := nullif(lower(btrim(coalesce(p_event_type, ''))), '');
begin
  perform private.billing_service_only();
  if v_id is null or v_id !~ '^evt_[A-Za-z0-9]+$' or char_length(v_id) > 255 then
    raise exception 'That Stripe event id is not valid.';
  end if;
  if v_type is null or v_type !~ '^[a-z0-9_.]+$' or char_length(v_type) > 120 then
    raise exception 'That Stripe event type is not valid.';
  end if;
  insert into public.stripe_events (id, event_type)
  values (v_id, v_type)
  on conflict (id) do nothing;
  return found;
end;
$fn$;

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

  -- One lock for the whole counter. Hold, confirm, and release take this
  -- row first so two checkouts cannot both pass the "under 100" check.
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
  values (p_profile, v_plan, 'held', now() + interval '30 minutes')
  returning id, expires_at into v_id, v_expires;

  return jsonb_build_object(
    'cohort', 'beta',
    'reservation_id', v_id,
    'beta_locked', false,
    'expires_at', v_expires
  );
end;
$fn$;

create or replace function public.beta_reservation_attach(
  p_reservation uuid,
  p_checkout_session_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session text := nullif(btrim(coalesce(p_checkout_session_id, '')), '');
  v_current text;
  v_status text;
begin
  perform private.billing_service_only();
  if p_reservation is null then
    raise exception 'That Beta reservation was not found.';
  end if;
  if v_session is null
     or v_session !~ '^cs_[A-Za-z0-9_]+$'
     or char_length(v_session) > 255 then
    raise exception 'That checkout session id is not valid.';
  end if;

  perform 1
  from public.beta_cohort_state s
  where s.id
  for update;

  select r.status, r.checkout_session_id
    into v_status, v_current
  from public.beta_reservations r
  where r.id = p_reservation
  for update;

  if not found or v_status is distinct from 'held' then
    raise exception 'That Beta reservation is not open.';
  end if;
  if v_current is not null and v_current is distinct from v_session then
    raise exception 'That Beta reservation already has a checkout.';
  end if;

  update public.beta_reservations
    set checkout_session_id = v_session
    where id = p_reservation;
end;
$fn$;

create or replace function public.beta_reservation_confirm(
  p_profile uuid,
  p_checkout_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session text := nullif(btrim(coalesce(p_checkout_session_id, '')), '');
  v_locked boolean;
  v_id uuid;
  v_status text;
  v_count integer;
begin
  perform private.billing_service_only();
  -- The membership trigger allows a billing write when no one is signed in
  -- on this statement. The caller check above already ran.
  perform set_config('request.jwt.claim.sub', '', true);
  if p_profile is null then
    raise exception 'That account was not found.';
  end if;
  if v_session is not null
     and (v_session !~ '^cs_[A-Za-z0-9_]+$' or char_length(v_session) > 255) then
    raise exception 'That checkout session id is not valid.';
  end if;

  select p.beta_locked into v_locked
  from public.profiles p
  where p.id = p_profile
  for update;

  if not found then
    raise exception 'That account was not found.';
  end if;

  perform 1
  from public.beta_cohort_state s
  where s.id
  for update;

  -- A session id wins when it is already stored. A hold that does not
  -- have a session yet still belongs to this profile. A held row that
  -- already points at a different checkout is left alone.
  select r.id, r.status
    into v_id, v_status
  from public.beta_reservations r
  where r.profile_id = p_profile
    and (
      (
        v_session is not null
        and r.checkout_session_id = v_session
        and r.status in ('held', 'confirmed')
      )
      or (
        r.status = 'held'
        and (
          v_session is null
          or r.checkout_session_id is null
        )
      )
    )
  order by
    case
      when v_session is not null and r.checkout_session_id = v_session then 0
      else 1
    end,
    r.created_at desc
  limit 1
  for update;

  if v_id is not null and v_status = 'confirmed' then
    if not v_locked then
      update public.profiles
        set beta_locked = true
        where id = p_profile;
      v_locked := true;
    end if;
    return jsonb_build_object(
      'beta_locked', v_locked,
      'counted', false,
      'reservation_status', 'confirmed'
    );
  end if;

  if v_locked and v_id is null then
    return jsonb_build_object(
      'beta_locked', true,
      'counted', false,
      'reservation_status', 'already_locked'
    );
  end if;

  if v_id is null then
    return jsonb_build_object(
      'beta_locked', false,
      'counted', false,
      'reservation_status', 'none'
    );
  end if;

  if v_locked then
    update public.beta_reservations
      set status = 'confirmed',
          confirmed_at = now()
      where id = v_id
        and status = 'held';
    return jsonb_build_object(
      'beta_locked', true,
      'counted', false,
      'reservation_status', 'confirmed'
    );
  end if;

  update public.beta_cohort_state
    set confirmed_count = confirmed_count + 1
    where id
      and confirmed_count < cohort_limit
    returning confirmed_count into v_count;

  if not found then
    update public.beta_reservations
      set status = 'released',
          released_at = now()
      where id = v_id
        and status = 'held';
    return jsonb_build_object(
      'beta_locked', false,
      'counted', false,
      'reservation_status', 'released'
    );
  end if;

  update public.beta_reservations
    set status = 'confirmed',
        confirmed_at = now()
    where id = v_id;

  update public.profiles
    set beta_locked = true
    where id = p_profile;

  return jsonb_build_object(
    'beta_locked', true,
    'counted', true,
    'reservation_status', 'confirmed',
    'confirmed_count', v_count
  );
end;
$fn$;

create or replace function public.beta_reservation_release(
  p_profile uuid default null,
  p_checkout_session_id text default null,
  p_reservation uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session text := nullif(btrim(coalesce(p_checkout_session_id, '')), '');
  v_n integer;
begin
  perform private.billing_service_only();
  if p_profile is null and v_session is null and p_reservation is null then
    raise exception 'Say which reservation to release.';
  end if;
  if v_session is not null
     and (v_session !~ '^cs_[A-Za-z0-9_]+$' or char_length(v_session) > 255) then
    raise exception 'That checkout session id is not valid.';
  end if;

  perform 1
  from public.beta_cohort_state s
  where s.id
  for update;

  update public.beta_reservations
    set status = 'released',
        released_at = now()
    where status = 'held'
      and (
        (p_reservation is not null and id = p_reservation)
        or (v_session is not null and checkout_session_id = v_session)
        or (
          p_profile is not null
          and profile_id = p_profile
          and p_reservation is null
          and v_session is null
        )
      );

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.beta_reservation_release_expired()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  perform private.billing_service_only();
  perform 1
  from public.beta_cohort_state s
  where s.id
  for update;

  update public.beta_reservations
    set status = 'released',
        released_at = now()
    where status = 'held'
      and expires_at <= now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

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
  v_downgrade boolean := false;
  v_linked boolean;
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
    v_status := 'past_due';
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
      'membership', v_row.membership,
      'billing_status', v_row.billing_status,
      'beta_locked', v_row.beta_locked,
      'complimentary', v_row.complimentary,
      'current_period_end', v_row.current_period_end,
      'stripe_customer_id', v_row.stripe_customer_id,
      'stripe_subscription_id', v_row.stripe_subscription_id
    );
  end if;

  v_membership := v_row.membership;
  v_period := coalesce(p_period_end, v_row.current_period_end);
  if v_status is null then
    v_status := v_row.billing_status;
  end if;

  if v_action = 'grant' then
    v_membership := v_plan;
    v_status := 'active';
  elsif v_action = 'sync' then
    if v_plan is not null and v_status in ('active', 'past_due') then
      v_membership := v_plan;
    end if;
    if v_status = 'canceled' and (v_period is null or v_period <= now()) then
      v_downgrade := true;
    elsif v_status = 'unpaid' and v_period is not null and v_period <= now() then
      v_downgrade := true;
    end if;
  elsif v_action = 'end' then
    if v_status is null or v_status not in ('canceled', 'unpaid') then
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
    select exists (
      select 1
      from public.trainer_clients t
      where t.client_id = p_profile
        and t.ended_at is null
    ) into v_linked;
    if v_linked then
      v_membership := 'free_client';
    else
      v_membership := 'none';
    end if;
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
        stripe_customer_id = coalesce(v_customer, stripe_customer_id),
        stripe_subscription_id = coalesce(v_subscription, stripe_subscription_id),
        billing_status = v_status,
        current_period_end = v_period
    where id = p_profile;

  if v_action = 'grant'
     or (v_action = 'sync' and v_status = 'active' and not v_downgrade) then
    v_confirm := public.beta_reservation_confirm(p_profile, p_checkout_session_id);
  end if;

  select * into v_row from public.profiles where id = p_profile;
  return jsonb_build_object(
    'applied', true,
    'membership', v_row.membership,
    'billing_status', v_row.billing_status,
    'beta_locked', v_row.beta_locked,
    'complimentary', v_row.complimentary,
    'current_period_end', v_row.current_period_end,
    'stripe_customer_id', v_row.stripe_customer_id,
    'stripe_subscription_id', v_row.stripe_subscription_id,
    'beta_confirm', v_confirm
  );
end;
$fn$;

revoke all on function public.stripe_event_begin(text, text) from public, anon, authenticated;
revoke all on function public.beta_reservation_hold(uuid, text) from public, anon, authenticated;
revoke all on function public.beta_reservation_attach(uuid, text) from public, anon, authenticated;
revoke all on function public.beta_reservation_confirm(uuid, text) from public, anon, authenticated;
revoke all on function public.beta_reservation_release(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.beta_reservation_release_expired() from public, anon, authenticated;
revoke all on function public.apply_stripe_membership(uuid, text, text, text, text, text, timestamp with time zone, text) from public, anon, authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.stripe_event_begin(text, text) to service_role;
    grant execute on function public.beta_reservation_hold(uuid, text) to service_role;
    grant execute on function public.beta_reservation_attach(uuid, text) to service_role;
    grant execute on function public.beta_reservation_confirm(uuid, text) to service_role;
    grant execute on function public.beta_reservation_release(uuid, text, uuid) to service_role;
    grant execute on function public.beta_reservation_release_expired() to service_role;
    grant execute on function public.apply_stripe_membership(uuid, text, text, text, text, text, timestamp with time zone, text) to service_role;
  end if;
end
$service$;

notify pgrst, 'reload schema';
