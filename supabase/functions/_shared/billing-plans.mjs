// Plan allowlist and the test/live lookup keys. Price ids stay in Stripe.
// Beta and standard amounts are both $9.99 / $19.99 / $29.99 for now.
// The keys stay separate so a later standard raise does not move the first 100.

export const PLANS = ['enthusiast', 'trainer', 'master_trainer']

export const SUCCESS_URL = 'https://coachtrainerapp.com/#/account?checkout=success'
export const CANCEL_URL = 'https://coachtrainerapp.com/#/subscriptions?checkout=cancel'
export const PORTAL_RETURN_URL = 'https://coachtrainerapp.com/#/account'

// Stable label so test and live Checkout can be compared. The last 8 letters
// are the suffix Stripe asks for. The same value is used in both modes.
export const INTEGRATION_ID = 'coachtrainer_kmbqwzrt'

const LOOKUP = /^(enthusiast|trainer|master_trainer)_(beta|standard)_monthly$/

export function lookupKey(plan, tier) {
  return plan + '_' + tier + '_monthly'
}

export function planFromLookupKey(key) {
  const match = LOOKUP.exec(String(key || ''))
  if (!match) return null
  return { plan: match[1], tier: match[2] }
}

export function isPlan(value) {
  return PLANS.indexOf(String(value || '')) !== -1
}

// Product id → plan. Metadata plan on the product is preferred.
// Leave this empty until a product id is known; do not invent one.
export const PRODUCT_PLANS = Object.freeze({})

export function planFromProduct(product, idMap) {
  if (!product || typeof product !== 'object') return null
  const map = idMap || PRODUCT_PLANS
  const meta = product.metadata || {}
  const named = String(meta.plan || meta.membership || '').trim().toLowerCase()
  if (isPlan(named)) return named
  const mapped = String(product.id && map[String(product.id)] || '').trim().toLowerCase()
  return isPlan(mapped) ? mapped : null
}
