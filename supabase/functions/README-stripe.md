# Stripe functions

Four Edge Functions. The Subscriptions page opens Checkout, switches a paid plan, and opens the billing portal. The webhook has no screen of its own. Do not deploy a change until William says so.

Checkout, plan changes, and the billing portal need the signed-in person's JWT. The webhook does not. Stripe cannot send one. The webhook checks the Stripe signature instead, and `supabase/config.toml` turns JWT verification off for that function only.

Nothing in this folder is a Stripe key. Keys live in Supabase function secrets.

## What each function does

`create-checkout-session` starts a hosted subscription Checkout for Enthusiast, Trainer, or Master Trainer. The person must already be approved. A complimentary account is refused, and so is an account that already has an active or trialing subscription. Those people use Manage billing. A past-due or unpaid subscription is not a plan. That person subscribes again.

The price is chosen with a Stripe lookup key: `enthusiast_beta_monthly`, `trainer_beta_monthly`, `master_trainer_beta_monthly`, or the matching `_standard_monthly` key. Beta is used when the profile is already Beta locked, or when fewer than 100 profiles are Beta locked. Otherwise the standard key is used. Checkout does not hold a seat. A few extra people can still receive the Beta price. Tax is not turned on.

If that customer already has an open Checkout for the same plan, the same URL is returned. Two clicks at once share one page: a short service-role claim, stored with the plan, lets only one request create a session. The other waits up to about 10 seconds for that page. A different plan waits for the in-flight create, then replaces the open page only while it is still open. The claim is cleared when the create finishes or fails. If the page is not ready in time, Checkout answers that it is starting and to try again. Checkout is refused when Stripe already shows an active or trialing subscription, an incomplete subscription from the last 30 minutes, or a Checkout completed in the last 30 minutes. An active or trialing subscription uses Manage billing.

`stripe-webhook` verifies the raw body with `STRIPE_WEBHOOK_SECRET`, records the event once with `stripe_event_begin`, and updates membership through `apply_stripe_membership`. A paid invoice grants the plan and period from the subscription line. The plan comes from the Stripe product (`metadata.plan`, or `metadata.membership`, or a product id in `PRODUCT_PLANS`). The price lookup key is only a fallback, so a later standard price still maps. A Beta price also sets `beta_locked` with `mark_beta_paid`. `customer.subscription.updated` syncs the membership to the price that is actually on the subscription and does not clear `beta_locked`. A pending update, and `customer.subscription.pending_update_expired`, do not change the plan. A failed renewal (`invoice.payment_failed` with `billing_reason` `subscription_cycle`) cancels that Stripe subscription immediately. The cancel uses `prorate` false and `invoice_now` false, so there is no credit and no new invoice. Stripe then sets `auto_advance` false on the open invoices, which stops Smart Retries. The account becomes no plan at the same time: membership `none`, and `plan_ended_at` set once. `customer.subscription.deleted` does the same end, including a voluntary cancel that reaches the end of the period. A failed plan-change invoice (`billing_reason` `subscription_update`) does not cancel while `pending_if_incomplete` still shows the subscription active or trialing. There is no past-due access. If Stripe reports `past_due` or `unpaid`, the webhook cancels that subscription and ends the stored plan. A deleted subscription ends access only when its id is the one stored on the profile. A linked payer becomes no plan, not Free Client. Free Client accounts are left as they are. `plan_ended_at` is cleared when a paid plan starts again. No email is sent. `notePlanEnded` is the hook for a later email that says the plan ended and the data is kept for 2 weeks. Cancelling a duplicate does not change the subscription that should be kept.

A paid invoice is written under a row lock. If that profile already has a different active subscription, the row is not overwritten. The newer subscription, by its Stripe created time, is canceled and its first invoice is refunded through the invoice payments list. A later invoice for the kept subscription checks Stripe again and refunds any newer live subscription still open. If that cancel or refund does not finish, the webhook answers with an error so Stripe tries again. The refund uses an idempotency key so a retry does not refund twice. `checkout.session.completed` ignores only an "already applied" repeat. Any other attach error is returned to Stripe.

`checkout.session.completed` attaches the customer and subscription when that does not replace an active one. A repeat that is already applied answers 200. Any other attach failure answers with an error so Stripe tries again.

`change-subscription` switches the signed-in person's own Stripe subscription to Enthusiast, Trainer, or Master Trainer. The browser sends a plan id only. The customer id is the one stored on the profile. A Beta-locked profile uses the Beta lookup key. Anyone else uses the standard key. The subscription item is updated with `proration_behavior` `always_invoice` and `payment_behavior` `pending_if_incomplete`. An upgrade invoices the difference now. If that payment fails, Stripe keeps the old price. A downgrade starts now, and the negative proration is left as customer balance credit. This function does not refund the card. The same plan, or no live subscription, answers 409. No live subscription tells the person to subscribe. A short claim keeps two requests from updating at once.

The response is `{ status: 'ok' }`, `{ status: 'payment_failed' }`, or `{ status: 'requires_action', url }` with the hosted invoice link when the card needs confirmation. Authentication is read from the invoice payment or `confirmation_secret`, not from a bare invoice. A decline is `payment_failed`. When the update is applied, membership is synced immediately with the same write the webhook uses, and `beta_locked` is left as it is. A later webhook sync writes the same fields.

`create-portal-session` opens the hosted Customer Portal for the signed-in person's own Stripe customer. A customer id sent by the browser is ignored. The session is `{ customer, return_url }` only, so Stripe uses the default portal configuration. Plan switching stays off in that portal. In-app changes use `change-subscription`.

## Secrets

In the Supabase dashboard, Project Settings → Edge Functions → Secrets, set:

- `STRIPE_SECRET_KEY` — a test secret or restricted key from the existing sandbox. Not a live key.
- `STRIPE_WEBHOOK_SECRET` — the signing secret from the test webhook endpoint.
- `SUPABASE_SERVICE_ROLE_KEY` — the service role key. The functions use it only to call the billing SQL and to read the signed-in person's own profile row.
- `SUPABASE_ANON_KEY` — the anon key already on the project. The function copies it to `SUPABASE_PUBLISHABLE_KEY` when that name is not set, which is what the Supabase server helper expects.
- `TEST_MODE` — `true` while this project is on the test sandbox. A live key is refused while this is set.

The portal does not take a configuration secret. Stripe uses the default Customer Portal configuration.

`SUPABASE_URL` is already provided on the hosted project. Do not paste any of these values into the repo.

## Deploy, when William says so

The billing SQL from `supabase/migrations/20261125200000_stripe_billing.sql` is already applied. Also apply `supabase/migrations/20261125230000_beta_paid_count.sql`. It adds the service-role Beta count, the paid-Beta lock, a short per-person Checkout claim, and the locked membership write. It adds `checkout_claim_until` on profiles and does not replace the billing functions from the earlier migration.

Apply `supabase/migrations/20261126145138_plan_end_data_hold.sql` in the same step as the `stripe-webhook` deploy. It adds `profiles.plan_ended_at`, ends a paid plan on failure instead of keeping past-due access, and schedules `purge-ended-plan-data` at 04:15 UTC when `pg_cron` is available. The job calls `private.purge_ended_plan_data()`. That function is not granted to the API. If `pg_cron` is not enabled yet, enable it and run the migration again so the schedule is created. The key that serves the webhook needs permission to cancel subscriptions.

Checkout and the portal allow the browser only from https://coachtrainerapp.com, and from http://localhost or http://127.0.0.1 on any port for local work. The webhook sends no browser headers.

```
supabase functions deploy create-checkout-session
supabase functions deploy create-portal-session
supabase functions deploy change-subscription
supabase functions deploy stripe-webhook --no-verify-jwt
```

Point a test-mode webhook at:

`https://thyrgloermygnezfareg.supabase.co/functions/v1/stripe-webhook`

Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.pending_update_expired`, `invoice.paid`, and `invoice.payment_failed`.

Return URLs go to https://coachtrainerapp.com/. Success lands on Account. Cancel lands on Subscriptions. The portal returns to Account.

Stripe Tax stays off until a tax registration exists. Turning on automatic tax before that collects nothing and reports no error.
