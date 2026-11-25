import { BillingError, assertStripeKeyAllowed } from './billing-guard.mjs'
import {
  CANCEL_URL,
  INTEGRATION_ID,
  SUCCESS_URL,
  isPlan,
  lookupKey
} from './billing-plans.mjs'

const STRIPE_MIN_SECONDS = 30 * 60
const CHECKOUT_SECONDS = 31 * 60
const HOLD_MARGIN_SECONDS = 60

const OPEN_SUBSCRIPTION = { active: true, trialing: true, past_due: true }

export function checkoutExpiresAt(nowMs, holdExpiresAt) {
  const nowSec = Math.floor(Number(nowMs) / 1000)
  const earliest = nowSec + STRIPE_MIN_SECONDS
  let target = nowSec + CHECKOUT_SECONDS
  if (holdExpiresAt) {
    const holdSec = Math.floor(new Date(holdExpiresAt).getTime() / 1000)
    if (!holdSec) throw new BillingError('Checkout could not be started.', 502)
    const latest = holdSec - HOLD_MARGIN_SECONDS
    if (target > latest) target = latest
    if (target < earliest) throw new BillingError('Checkout could not be started.', 502)
  }
  if (target < earliest) target = earliest
  return target
}

function keepsHold(err, session) {
  if (session && session.id) return true
  const message = String((err && err.message) || '')
  const code = String((err && (err.code || err.type)) || '')
  if (/idempotenc/i.test(message) || /idempotenc/i.test(code)) return true
  if (/duplicate/i.test(message)) return true
  return false
}

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
  if (profile.complimentary === true) {
    throw new BillingError('This account keeps its current plan. Checkout is not used.', 403)
  }
  if (OPEN_SUBSCRIPTION[profile.billing_status]) {
    throw new BillingError('You already have a subscription. Use Manage billing to change it.', 409)
  }

  let tier = 'standard'
  let reservationId = null
  let holdExpiresAt = null
  if (profile.beta_locked === true) {
    tier = 'beta'
  } else {
    const hold = await db.rpc('beta_reservation_hold', {
      p_profile: userId,
      p_plan: plan
    })
    tier = hold && hold.cohort === 'beta' ? 'beta' : 'standard'
    reservationId = hold && hold.reservation_id ? String(hold.reservation_id) : null
    if (tier === 'beta' && reservationId) {
      if (!hold.expires_at) throw new BillingError('Checkout could not be started.', 502)
      holdExpiresAt = hold.expires_at
    }
  }
  const expiresAt = checkoutExpiresAt(now, holdExpiresAt)

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
      expires_at: expiresAt,
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
    })
  } catch (err) {
    if (reservationId && !keepsHold(err, session)) {
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
