import { BillingError, assertStripeKeyAllowed, safeLog } from './billing-guard.mjs'
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
  if (err instanceof BillingError && (err.status === 409 || err.status === 403)) return true
  const message = String((err && err.message) || '')
  const code = String((err && (err.code || err.type)) || '')
  if (/idempotenc/i.test(message) || /idempotenc/i.test(code)) return true
  if (/duplicate/i.test(message)) return true
  return false
}

const ALREADY_SUBSCRIBED = 'You already have a subscription. Use Manage billing to change it.'

function httpStatus(err) {
  if (!err || typeof err !== 'object') return 0
  if (typeof err.statusCode === 'number') return err.statusCode
  return 0
}

function isMissing(err) {
  if (httpStatus(err) === 404) return true
  return String((err && err.code) || '') === 'resource_missing'
}

async function readSession(stripe, id) {
  try {
    return await stripe.checkout.sessions.retrieve(id)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

async function blockIfLiveComplete(stripe, storedId) {
  if (!storedId || !stripe.checkout.sessions.retrieve) return
  let session
  try {
    session = await readSession(stripe, storedId)
  } catch (_err) {
    throw new BillingError('Checkout could not be started.', 502)
  }
  if (!session || session.status !== 'complete') return
  const subId = idOf(session.subscription)
  if (!subId || !stripe.subscriptions || !stripe.subscriptions.retrieve) return
  let subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subId)
  } catch (err) {
    if (isMissing(err)) return
    throw new BillingError('Checkout could not be started.', 502)
  }
  if (subscription && OPEN_SUBSCRIPTION[subscription.status]) {
    throw new BillingError(ALREADY_SUBSCRIBED, 409)
  }
}

function logExpireMiss(log, customerId, sessionId) {
  safeLog(log, {
    customer_id: customerId,
    result: 'expire_open_session_failed',
    note: 'Open Checkout ' + (sessionId || '') + ' could not be expired. The new Checkout URL was still returned.'
  })
}

async function expireOtherOpenSessions(stripe, customerId, keepId, log) {
  if (!customerId || !stripe.checkout.sessions.list || !stripe.checkout.sessions.expire) return
  let rows
  try {
    const listed = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 100
    })
    rows = (listed && listed.data) || []
  } catch (_err) {
    logExpireMiss(log, customerId, null)
    return
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row.id || row.id === keepId) continue
    try {
      await stripe.checkout.sessions.expire(row.id)
    } catch (_err) {
      let current = null
      try {
        current = await readSession(stripe, row.id)
      } catch (_readErr) {
        logExpireMiss(log, customerId, row.id)
        continue
      }
      if (!current || current.status === 'expired') continue
      if (current.status === 'complete') {
        try { await stripe.checkout.sessions.expire(keepId) } catch (_keepErr) {}
        throw new BillingError(ALREADY_SUBSCRIBED, 409)
      }
      logExpireMiss(log, customerId, row.id)
    }
  }
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
  let priorSessionId = null
  if (profile.beta_locked === true) {
    tier = 'beta'
  } else {
    const hold = await db.rpc('beta_reservation_hold', {
      p_profile: userId,
      p_plan: plan
    })
    tier = hold && hold.cohort === 'beta' ? 'beta' : 'standard'
    reservationId = hold && hold.reservation_id ? String(hold.reservation_id) : null
    priorSessionId = hold && hold.checkout_session_id ? String(hold.checkout_session_id) : null
    if (tier === 'beta' && reservationId) {
      if (!hold.expires_at) throw new BillingError('Checkout could not be started.', 502)
      holdExpiresAt = hold.expires_at
    }
  }
  const expiresAt = checkoutExpiresAt(now, holdExpiresAt)

  let session
  let customerId = null
  try {
    const price = await priceFor(stripe, plan, tier)
    customerId = await customerFor(stripe, db, profile, userId, input.email)
    await blockIfLiveComplete(stripe, priorSessionId)
    const metadata = {
      user_id: userId,
      reservation_id: reservationId || ''
    }
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
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
    await db.rpc('beta_reservation_attach', {
      p_reservation: reservationId,
      p_checkout_session_id: session.id
    })
  }
  if (session && session.id) {
    await expireOtherOpenSessions(stripe, customerId, session.id, input.log)
  }

  if (!session || !session.url) throw new BillingError('Checkout could not be started.', 502)
  return { status: 200, body: { url: session.url } }
}
