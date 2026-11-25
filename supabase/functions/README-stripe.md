# Stripe functions

Three Edge Functions. They do not change the app screens. Do not deploy them until William says so.

Checkout and the billing portal need the signed-in person's JWT. The webhook does not. Stripe cannot send one. The webhook checks the Stripe signature instead, and `supabase/config.toml` turns JWT verification off for that function only.

Nothing in this folder is a Stripe key. Keys live in Supabase function secrets.

## What each function does

`create-checkout-session` starts a hosted subscription Checkout for Enthusiast, Trainer, or Master Trainer. The person must already be approved. A complimentary account is refused, and so is an account that already has an active, trialing, or past-due subscription. Those people use Manage billing.

The price is chosen with a Stripe lookup key: `enthusiast_beta_monthly`, `trainer_beta_monthly`, `master_trainer_beta_monthly`, or the matching `_standard_monthly` key. Beta is used when the profile is already Beta locked, or when fewer than 100 profiles are Beta locked. Otherwise the standard key is used. Checkout does not hold a seat. A few extra people can still receive the Beta price. Tax is not turned on.

If that customer already has an open Checkout, the same URL is returned. A second click does not open a second page and does not expire the first one.

`stripe-webhook` verifies the raw body with `STRIPE_WEBHOOK_SECRET`, records the event once with `stripe_event_begin`, and updates membership through `apply_stripe_membership`. A paid invoice grants the plan and period from the subscription line. A Beta price also sets `beta_locked` with `mark_beta_paid`. A failed payment marks that same subscription past due and does not remove access. A deleted subscription ends access only when its id is the one stored on the profile. Cancelling a duplicate does not change the subscription that should be kept.

If a second subscription is paid while another is already active, the newer one is canceled and its first invoice is refunded. The kept subscription is not changed. If that cancel does not leave the subscription canceled, the webhook answers with an error so Stripe tries again.

`checkout.session.completed` only attaches the customer and subscription. If that work was already done, or the event arrives out of order, it still answers 200.

`create-portal-session` opens the hosted Customer Portal for the signed-in person's own Stripe customer. A customer id sent by the browser is ignored.

## Secrets

In the Supabase dashboard, Project Settings → Edge Functions → Secrets, set:

- `STRIPE_SECRET_KEY` — a test secret or restricted key from the existing sandbox. Not a live key.
- `STRIPE_WEBHOOK_SECRET` — the signing secret from the test webhook endpoint.
- `SUPABASE_SERVICE_ROLE_KEY` — the service role key. The functions use it only to call the billing SQL and to read the signed-in person's own profile row.
- `SUPABASE_ANON_KEY` — the anon key already on the project. The function copies it to `SUPABASE_PUBLISHABLE_KEY` when that name is not set, which is what the Supabase server helper expects.
- `TEST_MODE` — `true` while this project is on the test sandbox. A live key is refused while this is set.
- `STRIPE_PORTAL_BETA_CONFIGURATION` and `STRIPE_PORTAL_STANDARD_CONFIGURATION` — optional, after the two Customer Portal configurations exist in the Dashboard. Beta-locked people must get the Beta configuration so a later price raise does not apply to them.

`SUPABASE_URL` is already provided on the hosted project. Do not paste any of these values into the repo.

## Deploy, when William says so

The billing SQL from `supabase/migrations/20261125200000_stripe_billing.sql` is already applied. Also apply `supabase/migrations/20261125230000_beta_paid_count.sql`. It adds `beta_paid_count` and `mark_beta_paid` for the service role only. It does not change the tables from the earlier billing migration.

Checkout and the portal allow the browser only from https://coachtrainerapp.com, and from http://localhost or http://127.0.0.1 on any port for local work. The webhook sends no browser headers.

```
supabase functions deploy create-checkout-session
supabase functions deploy create-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

Point a test-mode webhook at:

`https://thyrgloermygnezfareg.supabase.co/functions/v1/stripe-webhook`

Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.

Return URLs go to https://coachtrainerapp.com/. Success lands on Account. Cancel lands on Subscriptions. The portal returns to Account.

Stripe Tax stays off until a tax registration exists. Turning on automatic tax before that collects nothing and reports no error.
