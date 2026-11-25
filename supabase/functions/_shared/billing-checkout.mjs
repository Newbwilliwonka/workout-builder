import { BillingError, assertStripeKeyAllowed } from './billing-guard.mjs'
import {
  CANCEL_URL,
  INTEGRATION_ID,
  SUCCESS_URL,
  isPlan,
  lookupKey
} from './billing-plans.mjs'

const HOLD_MS = 31 * 60 * 1000

function idOf(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value.deleted) return null
  return value.id || null
}

async function priceFor(stripe, plan, tier) {
  const key = lookupKey(plan, tier)
  const listed = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
  const price = listed && listed.data && listed.data[0]
  if (!price || price.lookup_key !== key || !price.id) {
    throw new BillingError('Checkout could not be started.', 502)
  }
  return price.id
}

async function customerFor(stripe, db, profile, userId, email) {
  const existingId = profile.stripe_customer_id
  if (existingId) {
    try {
      const existing = await stripe.customers.retrieve(existingId)
      if (existing && !existing.deleted && existing.id) return existing.id
    } catch (_err) {
      // The stored customer is gone. A new one is created below.
    }
  }
  const created = await stripe.customers.create({
    email: email || undefined,
    metadata: {
      user_id: userId,
      supabase_user_id: userId
    }
  }, { idempotencyKey: 'customer-' + userId })
  const customerId = idOf(created)
  if (!customerId) throw new BillingError('Checkout could not be started.', 502)
  await db.rpc('apply_stripe_membership', {
    p_profile: userId,
    p_action: 'attach',
    p_customer_id: customerId
  })
  return customerId
}

export function planFromBody(body) {
  if (!body || typeof body !== 'object') return ''
  const plan = body.plan
  return typeof plan === 'string' ? plan : ''
}

export async function createCheckoutSession(input) {
  const stripe = input.stripe
  const db = input.db
  const userId = input.userId
  const plan = String(input.plan || '').trim()
  const now = typeof input.now === 'function' ? input.now() : Date.now()
  assertStripeKeyAllowed(input.secretKey, input.testMode)
  if (!userId) throw new BillingError('That account was not found.', 401)
  if (!isPlan(plan)) throw new BillingError('Choose Enthusiast, Trainer, or Master Trainer.', 400)

  const profile = await db.loadProfile(userId)
  if (!profile) throw new BillingError('That account was not found.', 404)
  if (profile.access_approved !== true) {
    throw new BillingError('Checkout opens after an admin approves the account.', 403)
  }

  let tier = 'standard'
  let reservationId = null
  if (profile.beta_locked === true) {
    tier = 'beta'
  } else {
    const hold = await db.rpc('beta_reservation_hold', {
      p_profile: userId,
      p_plan: plan
    })
    tier = hold && hold.cohort === 'beta' ? 'beta' : 'standard'
    reservationId = hold && hold.reservation_id ? String(hold.reservation_id) : null
  }

  let session
  try {
    const price = await priceFor(stripe, plan, tier)
    const customer = await customerFor(stripe, db, profile, userId, input.email)
    const metadata = {
      user_id: userId,
      reservation_id: reservationId || ''
    }
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer,
      client_reference_id: userId,
      line_items: [{ price: price, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      expires_at: Math.floor(now / 1000) + Math.floor(HOLD_MS / 1000),
      integration_identifier: INTEGRATION_ID,
      metadata: metadata,
      subscription_data: {
        metadata: {
          user_id: userId,
          supabase_user_id: userId,
          reservation_id: reservationId || '',
          plan: plan,
          tier: tier
        }
      }
    }, {
      idempotencyKey: reservationId
        ? 'checkout-' + reservationId
        : 'checkout-' + userId + '-' + plan + '-' + tier + '-' + Math.floor(now / HOLD_MS)
    })
  } catch (err) {
    if (reservationId) {
      try {
        await db.rpc('beta_reservation_release', {
          p_profile: null,
          p_checkout_session_id: null,
          p_reservation: reservationId
        })
      } catch (_releaseErr) {
        // The hold expires on its own if this release does not land.
      }
    }
    if (err instanceof BillingError) throw err
    throw new BillingError('Checkout could not be started.', 502)
  }

  if (reservationId && session && session.id) {
    try {
      await db.rpc('beta_reservation_attach', {
        p_reservation: reservationId,
        p_checkout_session_id: session.id
      })
    } catch (_err) {
      // The checkout URL is still returned. The webhook attaches this
      // session again when Stripe says it was paid.
    }
  }

  if (!session || !session.url) throw new BillingError('Checkout could not be started.', 502)
  return { status: 200, body: { url: session.url } }
}
