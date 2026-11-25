// Refuses a live Stripe key while TEST_MODE is on. No key values are stored here.

const ON = /^(1|true|yes|on)$/i

export class BillingError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'BillingError'
    this.status = status
  }
}

export function testModeOn(value) {
  return ON.test(String(value == null ? '' : value).trim())
}

export function keyIsLive(secretKey) {
  const key = String(secretKey || '')
  return key.startsWith('sk_live_') || key.startsWith('rk_live_')
}

export function assertStripeKeyAllowed(secretKey, testMode) {
  if (!secretKey) {
    throw new BillingError('Stripe is not configured.', 500)
  }
  if (testModeOn(testMode) && keyIsLive(secretKey)) {
    throw new BillingError('Live Stripe keys are refused while TEST_MODE is on.', 500)
  }
}

const PUBLIC_MESSAGE = [
  'Stripe is not configured.',
  'Live Stripe keys are refused while TEST_MODE is on.',
  'Choose Enthusiast, Trainer, or Master Trainer.',
  'Checkout opens after an admin approves the account.',
  'That account was not found.',
  'Checkout could not be started.',
  'Billing starts after you subscribe.',
  'The billing page could not be opened.',
  'Invalid signature.',
  'Webhook is not configured.',
  'Method not allowed.'
]

export function publicMessage(err, fallback) {
  const message = err && err.message ? String(err.message) : ''
  if (PUBLIC_MESSAGE.indexOf(message) !== -1) return message
  return fallback
}

// Logs only the ids a webhook needs. Drops keys, signatures, and card fields.
export function safeLog(logger, fields) {
  if (typeof logger !== 'function') return
  const keep = {}
  ;['event_id', 'event_type', 'customer_id', 'subscription_id', 'result'].forEach(function (key) {
    if (fields && fields[key] != null && fields[key] !== '') keep[key] = String(fields[key])
  })
  logger(keep)
}
