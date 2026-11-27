import { BillingError, assertStripeKeyAllowed } from './billing-guard.mjs'
import { isPlan, lookupKey } from './billing-plans.mjs'
import { resolvePricePlan } from './billing-price.mjs'
import { syncAppliedSubscription } from './billing-webhook.mjs'

// Stripe allows four properties in an expand path. Prefixing the payment
// intent with latest_invoice makes five, so the update only expands the
// invoice secret. The payment intent is loaded on invoices.retrieve.
const INVOICE_EXPAND = [
  'latest_invoice.confirmation_secret'
]

const LIVE = { active: true, trialing: true }
const NO_SUB = 'Subscribe to a plan before switching.'
const SAME = 'You are already on that plan.'
const BUSY = 'That plan change is already in progress.'
const FAIL = 'That plan could not be changed.'

function rowsOf(listed) {
  return (listed && listed.data) || []
}

async function priceFor(stripe, plan, tier) {
  const key = lookupKey(plan, tier)
  const listed = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
  const price = listed && listed.data && listed.data[0]
  if (!price || price.lookup_key !== key || !price.id) throw new BillingError(FAIL, 502)
  return price.id
}

async function liveSubscriptions(stripe, customerId) {
  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100
  })
  const rows = []
  const data = rowsOf(listed)
  for (let i = 0; i < data.length; i++) {
    if (data[i] && LIVE[data[i].status]) rows.push(data[i])
  }
  return rows
}

function firstItem(subscription) {
  const items = subscription && subscription.items && subscription.items.data
  return (items && items[0]) || null
}

function paymentIntent(invoice) {
  if (!invoice || typeof invoice !== 'object') return null
  if (invoice.payment_intent && typeof invoice.payment_intent === 'object') return invoice.payment_intent
  const rows = invoice.payments && (invoice.payments.data || invoice.payments)
  if (!Array.isArray(rows)) return null
  for (let i = 0; i < rows.length; i++) {
    const payment = rows[i] && (rows[i].payment || rows[i])
    const intent = payment && payment.payment_intent
    if (intent && typeof intent === 'object') return intent
  }
  return null
}

// The outcome follows the PaymentIntent. A confirmation_secret is also
// present on a decline, so it is not treated as authentication by itself.
function paymentStatus(invoice) {
  const intent = paymentIntent(invoice)
  if (!intent) return ''
  if (intent.status) return String(intent.status)
  if (intent.last_payment_error) return 'requires_payment_method'
  return ''
}

function invoiceIsPaid(invoice) {
  if (!invoice || typeof invoice !== 'object') return false
  if (invoice.status === 'paid') return true
  return paymentStatus(invoice) === 'succeeded'
}

async function invoiceOf(stripe, subscription) {
  const latest = subscription && subscription.latest_invoice
  if (!latest) return null
  let invoice = typeof latest === 'object' ? latest : null
  const id = typeof latest === 'string' ? latest : (invoice && invoice.id)
  if (invoiceIsPaid(invoice)) return invoice
  if (id && stripe.invoices && stripe.invoices.retrieve) {
    const loaded = await stripe.invoices.retrieve(id, {
      expand: ['payments.data.payment.payment_intent']
    })
    if (loaded) invoice = loaded
  }
  return invoice
}

function savedCancel(subscription) {
  // Classic period-end cancels set both fields. That shape is the flag.
  // Flexible portal cancels set only cancel_at.
  if (subscription && subscription.cancel_at_period_end === true) {
    return { cancel_at_period_end: true }
  }
  const at = subscription && Number(subscription.cancel_at)
  if (at && isFinite(at)) return { cancel_at: at }
  return null
}

function clearedCancel(saved) {
  if (saved.cancel_at_period_end === true) return { cancel_at_period_end: false }
  return { cancel_at: '' }
}

// A failed price change can leave pending_update. cancel_at is not a
// pending-update parameter. Voiding the invoice releases that pending
// update, then a single-field restore applies immediately and does not
// send payment_behavior.
async function restoreSavedCancel(stripe, subscriptionId, saved, failedSub, idempotencyKey) {
  if (!saved) return
  if (failedSub && failedSub.pending_update && stripe.invoices && stripe.invoices.voidInvoice) {
    const latest = failedSub.latest_invoice
    const invoiceId = typeof latest === 'string' ? latest : (latest && latest.id)
    if (invoiceId) await stripe.invoices.voidInvoice(invoiceId)
  }
  await stripe.subscriptions.update(subscriptionId, saved, { idempotencyKey: idempotencyKey })
}

function httpsUrl(value) {
  const url = typeof value === 'string' ? value : ''
  return url.indexOf('https://') === 0 ? url : ''
}

function resultOf(subscription, invoice) {
  const status = paymentStatus(invoice)
  const intent = paymentIntent(invoice)
  if (invoiceIsPaid(invoice) || status === 'succeeded') return { status: 'ok' }
  if (!(subscription && subscription.pending_update)) return { status: 'ok' }
  if (status === 'requires_action' || status === 'requires_confirmation') {
    const url = httpsUrl(invoice && invoice.hosted_invoice_url)
    if (!url) throw new BillingError(FAIL, 502)
    return { status: 'requires_action', url: url }
  }
  if (status === 'requires_payment_method' || status === 'canceled' || (intent && intent.last_payment_error)) {
    return { status: 'payment_failed' }
  }
  throw new BillingError(FAIL, 502)
}

function cardFailure(err) {
  if (!err || typeof err !== 'object') return false
  if (err.type === 'StripeCardError' || err.type === 'card_error') return true
  return err.code === 'card_declined'
}

export async function changeSubscription(input) {
  assertStripeKeyAllowed(input.secretKey, input.testMode)
  const userId = input.userId
  const plan = String(input.plan || '').trim()
  if (!userId) throw new BillingError('That account was not found.', 401)
  if (!isPlan(plan)) throw new BillingError('Choose Enthusiast, Trainer, or Master Trainer.', 400)

  const profile = await input.db.loadProfile(userId)
  if (!profile) throw new BillingError('That account was not found.', 404)
  if (profile.access_approved !== true) {
    throw new BillingError('Plan changes open after an admin approves the account.', 403)
  }
  if (profile.complimentary === true) {
    throw new BillingError('This account keeps its current plan. Checkout is not used.', 403)
  }
  // The customer id is the one stored for this person. A customer id in the
  // request body is never read.
  const customerId = profile.stripe_customer_id
  if (!customerId) throw new BillingError(NO_SUB, 409)

  const tier = profile.beta_locked === true ? 'beta' : 'standard'
  let ownClaim = false
  let claimToken = null
  try {
    const subs = await liveSubscriptions(input.stripe, customerId)
    if (!subs.length) throw new BillingError(NO_SUB, 409)
    if (subs.length !== 1) throw new BillingError(FAIL, 409)
    const subscription = subs[0]
    const item = firstItem(subscription)
    if (!item || !item.id) throw new BillingError(FAIL, 502)
    const current = await resolvePricePlan(input.stripe, item.price)
    if (current && current.plan === plan) throw new BillingError(SAME, 409)
    const priceId = await priceFor(input.stripe, plan, tier)
    const currentPrice = item.price && typeof item.price === 'object' ? item.price.id : item.price
    if (currentPrice === priceId) throw new BillingError(SAME, 409)

    const claim = await input.db.rpc('checkout_claim', { p_profile: userId, p_plan: plan })
    if (!claim || claim.granted !== true) throw new BillingError(BUSY, 409)
    ownClaim = true
    claimToken = claim.token || null

    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
    const saved = savedCancel(subscription)
    const restoreKey = 'restore-' + userId + '-' + (claimToken || priceId)
    let cleared = false
    let updated
    try {
      // Stripe rejects cancel_at together with cancel_at_period_end, and
      // rejects cancel_at when payment_behavior is pending_if_incomplete.
      // Clear a portal cancel on its own, with one field and no price change.
      if (saved) {
        await input.stripe.subscriptions.update(subscription.id, clearedCancel(saved), {
          idempotencyKey: 'uncancel-' + userId + '-' + (claimToken || priceId)
        })
        cleared = true
      }
      // always_invoice charges an upgrade now. A downgrade's negative
      // proration is left as customer balance credit. This call does not
      // refund the card. pending_if_incomplete keeps the old price when
      // the upgrade payment does not succeed.
      updated = await input.stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: priceId, quantity: quantity }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: INVOICE_EXPAND
      }, {
        idempotencyKey: 'change-' + userId + '-' + (claimToken || priceId)
      })
    } catch (err) {
      if (cleared) await restoreSavedCancel(input.stripe, subscription.id, saved, null, restoreKey)
      if (cardFailure(err)) return { status: 200, body: { status: 'payment_failed' } }
      throw new BillingError(FAIL, 502)
    }
    if (!updated || !updated.id) {
      if (cleared) await restoreSavedCancel(input.stripe, subscription.id, saved, null, restoreKey)
      throw new BillingError(FAIL, 502)
    }
    let invoice
    let body
    try {
      invoice = await invoiceOf(input.stripe, updated)
      body = resultOf(updated, invoice)
    } catch (err) {
      if (cleared) await restoreSavedCancel(input.stripe, subscription.id, saved, updated, restoreKey)
      throw err
    }
    if (body.status === 'payment_failed') {
      // Voiding the invoice would cancel a 3DS challenge. requires_action
      // keeps the open invoice so the member can finish it.
      if (cleared) await restoreSavedCancel(input.stripe, subscription.id, saved, updated, restoreKey)
    }
    if (body.status !== 'ok') return { status: 200, body: body }
    // The returned subscription can still show the old cancel_at. The
    // clear above removed it, so the stored date must clear too.
    await syncAppliedSubscription(input.stripe, input.db, input.log, {
      id: userId,
      stripe_customer_id: customerId
    }, Object.assign({}, updated, { cancel_at: null, cancel_at_period_end: false }), 'change-subscription')
    return { status: 200, body: body }
  } catch (err) {
    if (err instanceof BillingError) throw err
    throw new BillingError(FAIL, 502)
  } finally {
    if (ownClaim) {
      try {
        await input.db.rpc('checkout_claim_release', { p_profile: userId, p_token: claimToken })
      } catch (_releaseErr) {
        // The claim expires on its own if this release does not land.
      }
    }
  }
}
