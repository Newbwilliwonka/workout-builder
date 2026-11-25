# Stripe functions

Three Edge Functions. They do not change the app screens. Do not deploy them until William says so.

Checkout and the billing portal need the signed-in person's JWT. The webhook does not. Stripe cannot send one. The webhook checks the Stripe signature instead, and `supabase/config.toml` turns JWT verification off for that function only.

Nothing in this folder is a Stripe key. Keys live in Supabase function secrets.

## What each function does

`create-checkout-session` starts a hosted subscription Checkout for Enthusiast, Trainer, or Master Trainer. The person must already be approved. A complimentary account is refused, and so is an account that already has an active, trialing, or past-due subscription. Those people use Manage billing.

The price is chosen with a Stripe lookup key: `enthusiast_beta_monthly`, `trainer_beta_monthly`, `master_trainer_beta_monthly`, or the matching `_standard_monthly` key. Beta is used when the profile is already Beta locked, or when fewer than 100 profiles are Beta locked. Otherwise the standard key is used. Checkout does not hold a seat. A few extra people can still receive the Beta price. Tax is not turned on.

If that customer already has an open Checkout for the same plan, the same URL is returned. Two clicks at once share one page: a short service-role claim lets only one request create a session, and any later open page is expired so the earliest one remains. A click for a different plan expires the open page, only while it is still open, and starts the new plan. Checkout is refused when Stripe already shows an active, trialing, or past-due subscription, an incomplete subscription from the last 30 minutes, or a Checkout completed in the last 30 minutes. Those people use Manage billing.

`stripe-webhook` verifies the raw body with `STRIPE_WEBHOOK_SECRET`, records the event once with `stripe_event_begin`, and updates membership through `apply_stripe_membership`. A paid invoice grants the plan and period from the subscription line. A Beta price also sets `beta_locked` with `mark_beta_paid`. A failed payment marks that same subscription past due and does not remove access. A deleted subscription ends access only when its id is the one stored on the profile. Cancelling a duplicate does not change the subscription that should be kept.

A paid invoice is written under a row lock. If that profile already has a different active subscription, the row is not overwritten. The newer subscription, by its Stripe created time, is canceled and its first invoice is refunded. The older one keeps access. If that cancel does not leave the subscription canceled, the webhook answers with an error so Stripe tries again. `checkout.session.completed` ignores only an "already applied" repeat. Any other attach error is returned to Stripe.

`checkout.session.completed` attaches the customer and subscription when that does not replace an active one. A repeat that is already applied answers 200. Any other attach failure answers with an error so Stripe tries again.

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

The billing SQL from `supabase/migrations/20261125200000_stripe_billing.sql` is already applied. Also apply `supabase/migrations/20261125230000_beta_paid_count.sql`. It adds the service-role Beta count, the paid-Beta lock, a short per-person Checkout claim, and the locked membership write. It adds `checkout_claim_until` on profiles and does not replace the billing functions from the earlier migration.

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
