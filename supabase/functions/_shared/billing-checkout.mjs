import { BillingError, assertStripeKeyAllowed } from './billing-guard.mjs'
import {
  CANCEL_URL,
  INTEGRATION_ID,
  SUCCESS_URL,
  isPlan,
  lookupKey
} from './billing-plans.mjs'

const OPEN_SUBSCRIPTION = { active: true, trialing: true }
const BETA_LIMIT = 100
const RECENT_SECONDS = 30 * 60
const ALREADY = 'You already have a subscription. Use Manage billing to change it.'
const STARTING = 'Checkout is starting, try again in a moment.'
const WAIT_STEP_MS = 400
const WAIT_LIMIT_MS = 10000

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

function createdUnix(value) {
  const n = Number(value && value.created)
  return n > 0 ? n : 0
}

function rowsOf(listed) {
  return (listed && listed.data) || []
}

async function listOpen(stripe, customerId) {
  if (!customerId || !stripe.checkout || !stripe.checkout.sessions || !stripe.checkout.sessions.list) return []
  const listed = await stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 100
  })
  const rows = []
  const data = rowsOf(listed)
  for (let i = 0; i < data.length; i++) {
    if (data[i] && data[i].id && data[i].status !== 'complete') rows.push(data[i])
  }
  return rows
}

function sameOffer(session, plan, tier) {
  const meta = (session && session.metadata) || {}
  if (!meta.plan) return true
  if (meta.plan !== plan) return false
  if (meta.tier && meta.tier !== tier) return false
  return true
}

function byCreated(rows) {
  return rows.slice().sort(function (a, b) {
    const left = createdUnix(a) || Number.MAX_SAFE_INTEGER
    const right = createdUnix(b) || Number.MAX_SAFE_INTEGER
    return left - right
  })
}

async function readSession(stripe, id) {
  if (!stripe.checkout.sessions.retrieve) return null
  return stripe.checkout.sessions.retrieve(id)
}

async function expireIfOpen(stripe, session) {
  if (!session || !session.id || !stripe.checkout.sessions.expire) return
  let current = session
  if (stripe.checkout.sessions.retrieve) {
    current = await readSession(stripe, session.id)
  }
  if (!current || current.status === 'complete' || current.status === 'expired') return
  if (current.status !== 'open') return
  try {
    await stripe.checkout.sessions.expire(current.id)
  } catch (_err) {
    const again = await readSession(stripe, current.id)
    if (again && (again.status === 'complete' || again.status === 'expired')) return
    throw new BillingError('Checkout could not be started.', 502)
  }
}

async function payingAlready(stripe, customerId, nowMs) {
  if (!customerId) return false
  const cutoff = Math.floor(Number(nowMs) / 1000) - RECENT_SECONDS
  if (stripe.subscriptions && stripe.subscriptions.list) {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100
    })
    const data = rowsOf(listed)
    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      if (!row) continue
      if (row.status === 'active' || row.status === 'trialing') return true
      if (row.status === 'incomplete' && createdUnix(row) >= cutoff) return true
    }
  }
  if (stripe.checkout && stripe.checkout.sessions && stripe.checkout.sessions.list) {
    const listed = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'complete',
      limit: 100
    })
    const data = rowsOf(listed)
    for (let i = 0; i < data.length; i++) {
      if (data[i] && createdUnix(data[i]) >= cutoff) return true
    }
  }
  return false
}

function waitTiming(input) {
  const step = Number(input && input.waitMs)
  const limit = Number(input && input.waitForMs)
  return {
    step: step >= 0 ? step : WAIT_STEP_MS,
    limit: limit >= 0 ? limit : WAIT_LIMIT_MS
  }
}

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

async function waitForOffer(stripe, customerId, plan, tier, step, limit) {
  const started = Date.now()
  do {
    const open = byCreated(await listOpen(stripe, customerId))
    for (let i = 0; i < open.length; i++) {
      if (sameOffer(open[i], plan, tier) && open[i].url) return open[i].url
    }
    if (Date.now() - started >= limit) return null
    await sleep(step)
  } while (Date.now() - started < limit)
  return null
}

async function pollClaim(db, userId, plan, step, limit) {
  const started = Date.now()
  let claim = null
  do {
    if (Date.now() - started >= limit && claim) return claim
    claim = await db.rpc('checkout_claim', { p_profile: userId, p_plan: plan })
    if (claim && claim.granted === true) return claim
    if (Date.now() - started >= limit) return claim
    await sleep(step)
  } while (Date.now() - started < limit)
  return claim
}

async function keepEarliest(stripe, rows) {
  const ordered = byCreated(rows)
  if (!ordered.length) return null
  const keep = ordered[0]
  for (let i = 1; i < ordered.length; i++) {
    await expireIfOpen(stripe, ordered[i])
  }
  return keep
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

  const now = typeof input.now === 'function' ? input.now() : Date.now()
  let tier = 'standard'
  if (profile.beta_locked === true) {
    tier = 'beta'
  } else {
    const paid = countOf(await db.rpc('beta_paid_count'))
    tier = paid < BETA_LIMIT ? 'beta' : 'standard'
  }

  const timing = waitTiming(input)
  let ownClaim = false
  let claimToken = null
  try {
    const price = await priceFor(stripe, plan, tier)
    const customer = await customerFor(stripe, db, profile, userId, input.email)
    if (await payingAlready(stripe, customer, now)) {
      throw new BillingError(ALREADY, 409)
    }

    let claim = await db.rpc('checkout_claim', { p_profile: userId, p_plan: plan })
    if (!claim || claim.granted !== true) {
      const heldPlan = claim && claim.plan
      if (heldPlan && heldPlan !== plan) {
        claim = await pollClaim(db, userId, plan, timing.step, timing.limit)
        if (!claim || claim.granted !== true) throw new BillingError(STARTING, 409)
        ownClaim = true
        claimToken = claim.token || null
      } else {
        const waiting = await waitForOffer(stripe, customer, plan, tier, timing.step, timing.limit)
        if (waiting) return { status: 200, body: { url: waiting } }
        throw new BillingError(STARTING, 409)
      }
    } else {
      ownClaim = true
      claimToken = claim.token || null
    }

    let open = await listOpen(stripe, customer)
    const same = []
    const other = []
    for (let i = 0; i < open.length; i++) {
      if (sameOffer(open[i], plan, tier)) same.push(open[i])
      else other.push(open[i])
    }
    if (same.length) {
      for (let i = 0; i < other.length; i++) await expireIfOpen(stripe, other[i])
      const kept = await keepEarliest(stripe, same)
      if (!kept || !kept.url) throw new BillingError('Checkout could not be started.', 502)
      return { status: 200, body: { url: kept.url } }
    }
    for (let i = 0; i < other.length; i++) await expireIfOpen(stripe, other[i])

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
    if (!session || !session.id || !session.url) throw new BillingError('Checkout could not be started.', 502)
    open = await listOpen(stripe, customer)
    if (session.status !== 'complete') {
      let seen = false
      for (let i = 0; i < open.length; i++) if (open[i].id === session.id) seen = true
      if (!seen) open.push(session)
    }
    const kept = await keepEarliest(stripe, open)
    const url = kept && kept.url ? kept.url : session.url
    if (!url) throw new BillingError('Checkout could not be started.', 502)
    return { status: 200, body: { url: url } }
  } catch (err) {
    if (err instanceof BillingError) throw err
    throw new BillingError('Checkout could not be started.', 502)
  } finally {
    if (ownClaim) {
      try {
        await db.rpc('checkout_claim_release', { p_profile: userId, p_token: claimToken })
      } catch (_releaseErr) {
        // The claim expires on its own if this release does not land.
      }
    }
  }
}
