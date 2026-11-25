import { BillingError, assertStripeKeyAllowed, safeLog } from './billing-guard.mjs'
import { planFromLookupKey } from './billing-plans.mjs'

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

function priceRef(price) {
  if (!price) return null
  if (typeof price === 'string') return { id: price, lookup_key: null }
  return { id: price.id || null, lookup_key: price.lookup_key || null }
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

async function planForPrice(stripe, ref) {
  if (!ref) return null
  if (ref.lookup_key) {
    const parsed = planFromLookupKey(ref.lookup_key)
    if (parsed) return parsed.plan
  }
  if (!ref.id || !stripe || !stripe.prices || !stripe.prices.retrieve) return null
  const price = await stripe.prices.retrieve(ref.id)
  const parsed = planFromLookupKey(price && price.lookup_key)
  return parsed ? parsed.plan : null
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

function hadPaidAccess(row) {
  if (!row) return false
  if (row.billing_status === 'active' || row.billing_status === 'past_due' || row.billing_status === 'unpaid' || row.billing_status === 'canceled') {
    return true
  }
  return false
}

function sameActiveSubscription(row, subscriptionId) {
  return !!(
    row
    && subscriptionId
    && row.billing_status === 'active'
    && row.stripe_subscription_id
    && row.stripe_subscription_id === subscriptionId
  )
}

async function dispatch(stripe, db, event) {
  const type = event.type
  const object = event.data && event.data.object ? event.data.object : {}

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status === 'unpaid') return
    const userId = metaUser(object.metadata) || (UUID.test(String(object.client_reference_id || '')) ? String(object.client_reference_id) : null)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const profile = row.id
    const reservation = object.metadata && object.metadata.reservation_id
    if (reservation && UUID.test(String(reservation)) && object.id) {
      try {
        await db.rpc('beta_reservation_attach', {
          p_reservation: String(reservation),
          p_checkout_session_id: object.id
        })
      } catch (err) {
        if (!(err && /already has a checkout/i.test(err.message || ''))) throw err
      }
    }
    await db.rpc('apply_stripe_membership', {
      p_profile: profile,
      p_action: 'attach',
      p_customer_id: idOf(object.customer),
      p_subscription_id: idOf(object.subscription)
    })
    return
  }

  if (type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired') {
    const reservation = object.metadata && object.metadata.reservation_id
    if (reservation && UUID.test(String(reservation))) {
      await db.rpc('beta_reservation_release', {
        p_profile: null,
        p_checkout_session_id: null,
        p_reservation: String(reservation)
      })
    } else if (object.id) {
      await db.rpc('beta_reservation_release', {
        p_profile: null,
        p_checkout_session_id: object.id,
        p_reservation: null
      })
    }
    return
  }

  if (type === 'customer.subscription.created') {
    const userId = metaUser(object.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const status = billingStatus(object.status)
    // An incomplete subscription has not been paid. Do not store its id,
    // or a later delete would remove a complimentary plan.
    if (status === 'incomplete' || status === 'canceled') {
      if (status === 'canceled') {
        await db.rpc('beta_reservation_release', {
          p_profile: row.id,
          p_checkout_session_id: null,
          p_reservation: null
        })
      }
      return
    }
    await db.rpc('apply_stripe_membership', {
      p_profile: row.id,
      p_action: 'attach',
      p_customer_id: idOf(object.customer),
      p_subscription_id: object.id,
      p_billing_status: status,
      p_period_end: periodEndOf(object)
    })
    return
  }

  if (type === 'customer.subscription.updated') {
    const userId = metaUser(object.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const status = billingStatus(object.status)
    if ((status === 'canceled' || status === 'unpaid') && !hadPaidAccess(row)) {
      await db.rpc('beta_reservation_release', {
        p_profile: row.id,
        p_checkout_session_id: null,
        p_reservation: null
      })
      return
    }
    const plan = status === 'active' || status === 'past_due'
      ? await planForPrice(stripe, subscriptionPrice(object))
      : null
    await db.rpc('apply_stripe_membership', {
      p_profile: row.id,
      p_action: 'sync',
      p_plan: plan,
      p_billing_status: status,
      p_customer_id: idOf(object.customer),
      p_subscription_id: object.id,
      p_period_end: periodEndOf(object)
    })
    return
  }

  if (type === 'customer.subscription.deleted') {
    const userId = metaUser(object.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    await db.rpc('beta_reservation_release', {
      p_profile: row.id,
      p_checkout_session_id: null,
      p_reservation: null
    })
    if (!hadPaidAccess(row)) return
    const endedAt = object.ended_at ? isoFromUnix(object.ended_at) : null
    await db.rpc('apply_stripe_membership', {
      p_profile: row.id,
      p_action: 'end',
      p_customer_id: idOf(object.customer),
      p_subscription_id: object.id,
      p_billing_status: 'canceled',
      p_period_end: endedAt || periodEndOf(object)
    })
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
    const choice = invoiceChoice(object, subObject)
    const plan = await planForPrice(stripe, choice.ref)
    if (!plan) throw new BillingError('Checkout could not be started.', 500)
    const period = linePeriodEnd(choice.line)
      || subscriptionPeriodEnd(subObject)
      || isoFromUnix(object.period_end)
    await db.rpc('apply_stripe_membership', {
      p_profile: profile,
      p_action: 'grant',
      p_plan: plan,
      p_customer_id: idOf(object.customer),
      p_subscription_id: idOf(sub),
      p_period_end: period
    })
    await db.rpc('beta_reservation_confirm', {
      p_profile: profile,
      p_checkout_session_id: null
    })
    return
  }

  if (type === 'invoice.payment_failed') {
    const sub = invoiceSubscription(object)
    const subObject = sub && typeof sub === 'object' ? sub : null
    const userId = metaUser(object.parent && object.parent.subscription_details && object.parent.subscription_details.metadata)
      || metaUser(subObject && subObject.metadata)
    const row = await billingRow(db, idOf(object.customer), userId)
    if (!row) throw new BillingError('That account was not found.', 500)
    const profile = row.id
    const subId = idOf(sub)
    if (sameActiveSubscription(row, subId)) {
      await db.rpc('apply_stripe_membership', {
        p_profile: profile,
        p_action: 'past_due',
        p_customer_id: idOf(object.customer),
        p_subscription_id: subId
      })
    }
    await db.rpc('beta_reservation_release', {
      p_profile: profile,
      p_checkout_session_id: null,
      p_reservation: null
    })
  }
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

  await dispatch(input.stripe, input.db, event)
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
