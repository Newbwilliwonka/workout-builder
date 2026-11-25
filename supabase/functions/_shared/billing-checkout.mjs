import { BillingError, assertStripeKeyAllowed } from './billing-guard.mjs'
import {
  CANCEL_URL,
  INTEGRATION_ID,
  SUCCESS_URL,
  isPlan,
  lookupKey
} from './billing-plans.mjs'

const OPEN_SUBSCRIPTION = { active: true, trialing: true, past_due: true }
const BETA_LIMIT = 100

function idOf(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value.deleted) return null
  return value.id || null
}

function countOf(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n) || n < 0) throw new BillingError('Checkout could not be started.', 502)
  return n
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

async function openCheckoutUrl(stripe, customerId) {
  if (!customerId || !stripe.checkout || !stripe.checkout.sessions || !stripe.checkout.sessions.list) {
    return null
  }
  const listed = await stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 1
  })
  const row = listed && listed.data && listed.data[0]
  if (!row || !row.id) return null
  if (!row.url) throw new BillingError('Checkout could not be started.', 502)
  return row.url
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
  if (profile.beta_locked === true) {
    tier = 'beta'
  } else {
    const paid = countOf(await db.rpc('beta_paid_count'))
    tier = paid < BETA_LIMIT ? 'beta' : 'standard'
  }

  try {
    const price = await priceFor(stripe, plan, tier)
    const customer = await customerFor(stripe, db, profile, userId, input.email)
    const openUrl = await openCheckoutUrl(stripe, customer)
    if (openUrl) return { status: 200, body: { url: openUrl } }

    const metadata = {
      user_id: userId,
      plan: plan,
      tier: tier
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer,
      client_reference_id: userId,
      line_items: [{ price: price, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      integration_identifier: INTEGRATION_ID,
      metadata: metadata,
      subscription_data: {
        metadata: {
          user_id: userId,
          supabase_user_id: userId,
          plan: plan,
          tier: tier
        }
      }
    })
    if (!session || !session.url) throw new BillingError('Checkout could not be started.', 502)
    return { status: 200, body: { url: session.url } }
  } catch (err) {
    if (err instanceof BillingError) throw err
    throw new BillingError('Checkout could not be started.', 502)
  }
}
