import { BillingError, assertStripeKeyAllowed, safeLog } from './billing-guard.mjs'
import { priceRef, resolvePricePlan } from './billing-price.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function idOf(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value.deleted) return null
  return value.id || null
}

function isoFromUnix(seconds) {
  const n = Number(seconds)
  if (!n || !isFinite(n)) return null
  return new Date(n * 1000).toISOString()
}

function periodEndOf(subscription) {
  const items = subscription && subscription.items && subscription.items.data
  const item = items && items[0]
  const unix = (item && item.current_period_end) || (subscription && subscription.current_period_end) || (subscription && subscription.ended_at)
  return isoFromUnix(unix)
}

function billingStatus(status) {
  if (status === 'active' || status === 'past_due' || status === 'unpaid' || status === 'canceled' || status === 'incomplete') {
    return status
  }
  if (status === 'incomplete_expired') return 'canceled'
  return null
}

function metaUser(meta) {
  if (!meta) return null
  const id = meta.supabase_user_id || meta.user_id || null
  return id && UUID.test(String(id)) ? String(id) : null
}

function subscriptionPrice(subscription) {
  const items = subscription && subscription.items && subscription.items.data
  const item = items && items[0]
  return priceRef(item && item.price)
}

function linePrice(line) {
  if (!line) return null
  const nested = line.pricing && line.pricing.price_details && line.pricing.price_details.price
  return priceRef(nested || line.price)
}

function isProration(line) {
  if (!line) return false
  if (line.proration === true) return true
  const parent = line.parent || null
  const details = parent && (parent.subscription_item_details || parent.invoice_item_details)
  if (details && details.proration === true) return true
  if (typeof line.amount === 'number' && line.amount < 0) return true
  return false
}

function isCurrentSubscriptionLine(line) {
  if (!line || isProration(line)) return false
  const parent = line.parent || null
  const parentType = parent && parent.type
  if (line.type === 'subscription' || parentType === 'subscription_item_details') return true
  if (parent && parent.subscription_item_details && parent.subscription_item_details.proration !== true) return true
  return false
}

function invoiceChoice(invoice, subscription) {
  const lines = (invoice && invoice.lines && invoice.lines.data) || []
  const current = subscriptionPrice(subscription)
  const usable = []
  for (let i = 0; i < lines.length; i++) {
    if (isCurrentSubscriptionLine(lines[i])) usable.push(lines[i])
  }
  if (current && current.id) {
    for (let i = 0; i < usable.length; i++) {
      const ref = linePrice(usable[i])
      if (ref && ref.id === current.id) return { ref: ref, line: usable[i] }
    }
  }
  if (usable.length) {
    const ref = linePrice(usable[usable.length - 1])
    return { ref: ref, line: usable[usable.length - 1] }
  }
  if (current) return { ref: current, line: null }
  return { ref: null, line: null }
}

function linePeriodEnd(line) {
  const end = line && line.period && line.period.end
  return isoFromUnix(end)
}

function subscriptionPeriodEnd(subscription) {
  if (!subscription) return null
  if (subscription.current_period_end) return isoFromUnix(subscription.current_period_end)
  return periodEndOf(subscription)
}

function invoiceSubscription(invoice) {
  const parent = invoice && invoice.parent && invoice.parent.subscription_details
  if (parent && parent.subscription) return parent.subscription
  return invoice && invoice.subscription ? invoice.subscription : null
}

function parsedPrice(stripe, ref) {
  return resolvePricePlan(stripe, ref)
}

function paymentRefund(row) {
  const payment = row && (row.payment || row)
  if (!payment) return null
  const intent = idOf(payment.payment_intent)
  if (intent) return { payment_intent: intent }
  const charge = idOf(payment.charge)
  if (charge) return { charge: charge }
  return null
}

async function invoicePaymentRows(stripe, invoice) {
  if (stripe.invoicePayments && stripe.invoicePayments.list && invoice && invoice.id) {
    const listed = await stripe.invoicePayments.list({
      invoice: invoice.id,
      limit: 10,
      expand: ['data.payment.payment_intent']
    })
    return (listed && listed.data) || []
  }
  const embedded = invoice && invoice.payments && (invoice.payments.data || invoice.payments)
  if (Array.isArray(embedded)) return embedded
  return []
}

async function refundFirstInvoice(stripe, subscriptionId) {
  if (!stripe.invoices || !stripe.invoices.list || !stripe.refunds || !stripe.refunds.create) {
    throw new BillingError('Checkout could not be started.', 502)
  }
  const listed = await stripe.invoices.list({ subscription: subscriptionId, limit: 100 })
  const rows = (listed && listed.data) || []
  const paid = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].status === 'paid' && rows[i].id) paid.push(rows[i])
  }
  if (!paid.length) throw new BillingError('Checkout could not be started.', 502)
  paid.sort(function (a, b) { return Number(a.created || 0) - Number(b.created || 0) })
  const first = paid[0]
  const payments = await invoicePaymentRows(stripe, first)
  let target = null
  for (let i = 0; i < payments.length; i++) {
    target = paymentRefund(payments[i])
    if (target) break
  }
  if (!target) throw new BillingError('Checkout could not be started.', 502)
  try {
    await stripe.refunds.create(target, { idempotencyKey: 'refund-' + first.id })
  } catch (err) {
    if (err && err.code === 'charge_already_refunded') return
    throw err
  }
}

function asRow(found) {
  if (found && typeof found === 'object' && found.id) return found
  if (typeof found === 'string') {
    return { id: found, complimentary: false, billing_status: null, stripe_subscription_id: null }
  }
  return null
}

async function billingRow(db, customerId, userId) {
  return asRow(await db.findProfile(customerId, userId))
}

function sameStoredSubscription(row, subscriptionId) {
  return !!(row && subscriptionId && row.stripe_subscription_id && row.stripe_subscription_id === subscriptionId)
}

// Cancel immediately, without a credit and without a new invoice.
// Stripe then sets auto_advance false on open invoices, so Smart Retries stop.
// A subscription that is already canceled, or already gone, is left as it is.
async function cancelSubscriptionNow(stripe, subId, idempotencyKey) {
  if (!subId) return
  if (!stripe || !stripe.subscriptions || !stripe.subscriptions.cancel || !stripe.subscriptions.retrieve) {
    throw new BillingError('Could not update billing.', 502)
  }
  let status = ''
  try {
    status = await subscriptionStatus(stripe, subId)
  } catch (err) {
    if (err && (err.code === 'resource_missing' || err.statusCode === 404)) return
    throw err
  }
  if (status === 'canceled' || status === 'incomplete_expired') return
  const params = { prorate: false, invoice_now: false }
  const opts = idempotencyKey ? { idempotencyKey: idempotencyKey } : undefined
  try {
    await stripe.subscriptions.cancel(subId, params, opts)
  } catch (err) {
    let after = ''
    try {
      after = await subscriptionStatus(stripe, subId)
    } catch (readErr) {
      if (readErr && (readErr.code === 'resource_missing' || readErr.statusCode === 404)) return
      throw err
    }
    if (after !== 'canceled' && after !== 'incomplete_expired') throw err
  }
}

// TODO(email): Send the end-of-plan email once an email service is chosen.
// Text: your plan ended; we'll keep your data for 2 weeks so you can rejoin.
export function notePlanEnded(log) {
  safeLog(log, {
    result: 'plan_ended_email_pending',
    note: 'No email is sent yet.'
  })
}

async function endStoredPlan(db, log, row, subId, customerId, periodEnd) {
  const written = await db.rpc('apply_stripe_membership', {
    p_profile: row.id,
    p_action: 'end',
    p_customer_id: customerId,
    p_subscription_id: subId,
    p_billing_status: 'canceled',
    p_period_end: periodEnd || new Date().toISOString()
  })
  if (written && written.newly_ended === true) notePlanEnded(log)
  return written
}

const DUPLICATE_NOTE = 'Refund the duplicate subscription. This account already has an active one.'

async function subscriptionStatus(stripe, subscriptionId) {
  const loaded = await stripe.subscriptions.retrieve(subscriptionId)
  return loaded && loaded.status ? loaded.status : ''
}

function alreadyApplied(err) {
  return String((err && err.message) || '').toLowerCase().indexOf('already applied') !== -1
}

async function cancelAndRefund(stripe, log, subId, customerId, eventType) {
  if (!subId) throw new BillingError('Checkout could not be started.', 502)
  if (!stripe || !stripe.subscriptions || !stripe.subscriptions.retrieve || !stripe.subscriptions.cancel) {
    throw new BillingError('Checkout could not be started.', 502)
  }
  let status = await subscriptionStatus(stripe, subId)
  if (status !== 'canceled') {
    try {
      await stripe.subscriptions.cancel(subId)
    } catch (err) {
      let after = ''
      try {
        after = await subscriptionStatus(stripe, subId)
      } catch (_readErr) {
        throw err
      }
      if (after !== 'canceled') throw err
    }
  }
  await refundFirstInvoice(stripe, subId)
  safeLog(log, {
    event_type: eventType,
    customer_id: customerId,
    subscription_id: subId,
    result: 'canceled_duplicate_refund',
    note: DUPLICATE_NOTE
  })
}

async function settleDuplicate(stripe, db, log, profileId, signal, plan, customerId, periodEnd, eventType) {
  const keptId = signal && signal.kept_subscription_id
  const incomingId = signal && signal.incoming_subscription_id
  if (!keptId || !incomingId) throw new BillingError('Checkout could not be started.', 502)
  const kept = await stripe.subscriptions.retrieve(keptId)
  const incoming = await stripe.subscriptions.retrieve(incomingId)
  const keptCreated = Number(kept && kept.created) || 0
  const incomingCreated = Number(incoming && incoming.created) || 0
  const incomingIsNewer = incomingCreated >= keptCreated
  const newerId = incomingIsNewer ? incomingId : keptId
  const olderId = incomingIsNewer ? keptId : incomingId
  if (!incomingIsNewer) {
    const switched = await db.rpc('keep_paid_subscription', {
      p_profile: profileId,
      p_subscription_id: olderId,
      p_replace_id: newerId,
      p_plan: plan || null,
      p_customer_id: customerId,
      p_period_end: periodEnd || null
    })
    if (!switched || switched.applied !== true) {
      throw new BillingError('Checkout could not be started.', 502)
    }
  }
  await cancelAndRefund(stripe, log, newerId, customerId, eventType)
  return olderId
}

async function billingWrite(db, args) {
  return db.rpc('billing_write', args)
}

const LIVE_SUBSCRIPTION = { active: true, trialing: true, past_due: true }

async function sweepNewerSubscriptions(stripe, log, keptId, customerId, eventType) {
  if (!keptId || !customerId || !stripe.subscriptions || !stripe.subscriptions.list) return
  const listed = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
  const data = (listed && listed.data) || []
  let keptCreated = null
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (!row || !row.id || row.id === keptId) continue
    if (!LIVE_SUBSCRIPTION[row.status]) continue
    if (keptCreated == null) {
      const kept = await stripe.subscriptions.retrieve(keptId)
      keptCreated = Number(kept && kept.created) || 0
    }
    const created = Number(row.created) || 0
    if (created >= keptCreated) {
      await cancelAndRefund(stripe, log, row.id, customerId, eventType)
    }
  }
}

async function dispatch(stripe, db, event, log) {
  const type = event.type
  const object = event.data && event.data.object ? event.data.object : {}

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status === 'unpaid') return
    const userId = metaUser(object.metadata) || (UUID.test(String(object.client_reference_id || '')) ? String(object.client_reference_id) : null)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) {
      safeLog(log, {
        event_type: type,
        customer_id: idOf(object.customer),
        subscription_id: idOf(object.subscription),
        result: 'checkout_already_applied',
        note: 'Checkout completion did not change membership.'
      })
      return
    }
    const profile = row.id
    const paidSub = idOf(object.subscription)
    try {
      const written = await billingWrite(db, {
        p_profile: profile,
        p_action: 'attach',
        p_customer_id: idOf(object.customer),
        p_subscription_id: paidSub
      })
      if (written && written.duplicate === true) {
        await settleDuplicate(stripe, db, log, profile, written, null, row.stripe_customer_id || idOf(object.customer), null, type)
      }
    } catch (err) {
      if (!alreadyApplied(err)) throw err
      safeLog(log, {
        event_type: type,
        customer_id: row.stripe_customer_id || idOf(object.customer),
        subscription_id: paidSub,
        result: 'checkout_already_applied',
        note: 'Checkout completion did not change membership.'
      })
    }
    return
  }

  if (type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired') {
    return
  }

  if (type === 'customer.subscription.created') {
    const userId = metaUser(object.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const status = billingStatus(object.status)
    // An incomplete subscription has not been paid. Do not store its id,
    // or a later delete would remove a complimentary plan.
    if (status === 'incomplete' || status === 'canceled') return
    const written = await billingWrite(db, {
      p_profile: row.id,
      p_action: 'attach',
      p_customer_id: idOf(object.customer),
      p_subscription_id: object.id,
      p_billing_status: status,
      p_period_end: periodEndOf(object)
    })
    if (written && written.duplicate === true) {
      await settleDuplicate(stripe, db, log, row.id, written, null, row.stripe_customer_id || idOf(object.customer), periodEndOf(object), type)
    }
    return
  }

  // The old price is unchanged when a pending update expires. Do not
  // read a price off that event, or a failed upgrade would stick.
  if (type === 'customer.subscription.pending_update_expired') {
    return
  }

  if (type === 'customer.subscription.updated') {
    const userId = metaUser(object.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    // past_due and unpaid are not an access state. Cancel so retries stop,
    // and end the stored plan. A different subscription does not end this one.
    if (object.status === 'past_due' || object.status === 'unpaid') {
      if (object.id) await cancelSubscriptionNow(stripe, object.id, 'cancel-ended-' + object.id)
      if (sameStoredSubscription(row, object.id)) {
        await endStoredPlan(db, log, row, object.id, idOf(object.customer), new Date().toISOString())
      }
      return
    }
    await syncAppliedSubscription(stripe, db, log, row, object, type)
    return
  }

  if (type === 'customer.subscription.deleted') {
    const userId = metaUser(object.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    if (!row.stripe_subscription_id || row.stripe_subscription_id !== object.id) return
    const endedAt = object.ended_at ? isoFromUnix(object.ended_at) : null
    await endStoredPlan(db, log, row, object.id, idOf(object.customer), endedAt || periodEndOf(object))
    return
  }

  if (type === 'invoice.paid') {
    const sub = invoiceSubscription(object)
    const subObject = sub && typeof sub === 'object' ? sub : null
    const userId = metaUser(object.parent && object.parent.subscription_details && object.parent.subscription_details.metadata)
      || metaUser(subObject && subObject.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const profile = row.id
    let choice = invoiceChoice(object, subObject)
    let periodSource = subObject
    if (!choice.ref) {
      const subId = typeof sub === 'string' ? sub : idOf(sub)
      if (subId && stripe && stripe.subscriptions && stripe.subscriptions.retrieve) {
        const loaded = await stripe.subscriptions.retrieve(subId)
        periodSource = loaded
        choice = invoiceChoice(object, loaded)
        if (!choice.ref) choice = { ref: subscriptionPrice(loaded), line: null }
      }
    }
    const paidSubId = typeof sub === 'string' ? sub : idOf(sub)
    const parsed = await parsedPrice(stripe, choice.ref)
    if (!parsed || !parsed.plan) throw new BillingError('Checkout could not be started.', 500)
    const period = linePeriodEnd(choice.line)
      || subscriptionPeriodEnd(periodSource)
      || isoFromUnix(object.period_end)
    const customerId = idOf(object.customer)
    const written = await billingWrite(db, {
      p_profile: profile,
      p_action: 'grant',
      p_plan: parsed.plan,
      p_customer_id: customerId,
      p_subscription_id: paidSubId,
      p_period_end: period,
      p_beta: parsed.tier === 'beta'
    })
    const payer = row.stripe_customer_id || customerId
    let keptId = paidSubId
    if (written && written.duplicate === true) {
      keptId = await settleDuplicate(stripe, db, log, profile, written, parsed.plan, payer, period, type)
    }
    await sweepNewerSubscriptions(stripe, log, keptId, payer, type)
    return
  }

  if (type === 'invoice.payment_failed') {
    const sub = invoiceSubscription(object)
    const subObject = sub && typeof sub === 'object' ? sub : null
    const userId = metaUser(object.parent && object.parent.subscription_details && object.parent.subscription_details.metadata)
      || metaUser(subObject && subObject.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const subId = idOf(sub)
    const reason = object.billing_reason || ''
    // A failed upgrade or downgrade uses pending_if_incomplete. Stripe keeps
    // the subscription active on the current price. Do not cancel that.
    if (reason === 'subscription_update') {
      let liveStatus = ''
      if (subId && stripe && stripe.subscriptions && stripe.subscriptions.retrieve) {
        try {
          liveStatus = await subscriptionStatus(stripe, subId)
        } catch (_err) {
          liveStatus = ''
        }
      }
      if (liveStatus === 'active' || liveStatus === 'trialing') return
      if ((liveStatus === 'past_due' || liveStatus === 'unpaid') && subId) {
        await cancelSubscriptionNow(stripe, subId, 'cancel-failed-update-' + (object.id || subId))
        if (sameStoredSubscription(row, subId)) {
          await endStoredPlan(db, log, row, subId, idOf(object.customer), new Date().toISOString())
        }
      }
      return
    }
    // A renewal (subscription_cycle) ends now. Cancel stops Smart Retries.
    if (reason === 'subscription_cycle' && subId) {
      await cancelSubscriptionNow(stripe, subId, 'cancel-failed-renewal-' + (object.id || subId))
      if (sameStoredSubscription(row, subId)) {
        await endStoredPlan(db, log, row, subId, idOf(object.customer), new Date().toISOString())
      }
    }
  }
}

// The plan comes from the product. p_beta is omitted so beta_locked stays.
// A later webhook sync of the same subscription writes the same fields.
export async function syncAppliedSubscription(stripe, db, log, row, subscription, eventType) {
  if (!row || !subscription) return null
  const status = billingStatus(subscription.status)
  const parsed = !subscription.pending_update && status === 'active'
    ? await parsedPrice(stripe, subscriptionPrice(subscription))
    : null
  const plan = parsed ? parsed.plan : null
  const periodEnd = periodEndOf(subscription)
  const written = await billingWrite(db, {
    p_profile: row.id,
    p_action: 'sync',
    p_plan: plan,
    p_billing_status: status,
    p_customer_id: idOf(subscription.customer),
    p_subscription_id: subscription.id,
    p_period_end: periodEnd
  })
  if (written && written.duplicate === true) {
    await settleDuplicate(
      stripe,
      db,
      log,
      row.id,
      written,
      plan,
      row.stripe_customer_id || idOf(subscription.customer),
      periodEnd,
      eventType || 'customer.subscription.updated'
    )
  }
  return written
}

export async function handleWebhook(input) {
  assertStripeKeyAllowed(input.secretKey, input.testMode)
  if (!input.webhookSecret) throw new BillingError('Webhook is not configured.', 500)
  const rawBody = input.rawBody
  const signature = input.signature
  if (!rawBody || !signature) throw new BillingError('Invalid signature.', 400)

  let event
  try {
    event = await input.constructEvent(rawBody, signature, input.webhookSecret)
  } catch (_err) {
    throw new BillingError('Invalid signature.', 400)
  }
  if (!event || !event.id || !event.type) throw new BillingError('Invalid signature.', 400)

  const seen = await input.db.eventSeen(event.id)
  if (seen) {
    safeLog(input.log, { event_id: event.id, event_type: event.type, result: 'duplicate' })
    return { status: 200, body: { received: true } }
  }

  await dispatch(input.stripe, input.db, event, input.log)
  const recorded = await input.db.rpc('stripe_event_begin', {
    p_event_id: event.id,
    p_event_type: event.type
  })
  safeLog(input.log, {
    event_id: event.id,
    event_type: event.type,
    customer_id: idOf(event.data && event.data.object && event.data.object.customer),
    subscription_id: idOf(event.data && event.data.object && (event.data.object.subscription || event.data.object.id)),
    result: recorded === false ? 'duplicate' : 'ok'
  })
  return { status: 200, body: { received: true } }
}
