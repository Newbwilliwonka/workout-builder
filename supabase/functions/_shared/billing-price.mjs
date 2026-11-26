import { planFromLookupKey, planFromProduct } from './billing-plans.mjs'

const TIER = /^(beta|standard)$/

function tierName(value) {
  const tier = String(value || '').trim().toLowerCase()
  return TIER.test(tier) ? tier : null
}

export function priceRef(price) {
  if (!price) return null
  if (typeof price === 'string') return { id: price, lookup_key: null, product: null, metadata: null }
  return {
    id: price.id || null,
    lookup_key: price.lookup_key || null,
    product: price.product || null,
    metadata: price.metadata || null
  }
}

function tierOf(lookup, metadata) {
  const parsed = lookup ? planFromLookupKey(lookup) : null
  if (parsed && parsed.tier) return parsed.tier
  return tierName(metadata && metadata.tier)
}

async function productPlan(stripe, product) {
  if (!product) return null
  if (typeof product === 'object') return planFromProduct(product)
  if (typeof product !== 'string' || !stripe || !stripe.products || !stripe.products.retrieve) return null
  const loaded = await stripe.products.retrieve(product)
  return planFromProduct(loaded)
}

async function fromParts(stripe, ref) {
  if (!ref) return null
  const keyPlan = ref.lookup_key ? planFromLookupKey(ref.lookup_key) : null
  const product = ref.product
  const productMeta = product && typeof product === 'object' ? product.metadata : null
  const tier = tierOf(ref.lookup_key, ref.metadata) || tierName(productMeta && productMeta.tier)
  const fromProduct = await productPlan(stripe, product)
  const plan = fromProduct || (keyPlan && keyPlan.plan)
  if (!plan) return null
  return { plan: plan, tier: tier }
}

function needsPrice(ref) {
  if (!ref || !ref.id) return false
  if (ref.product) return false
  if (ref.lookup_key && planFromLookupKey(ref.lookup_key)) return false
  return true
}

// Plan comes from the product. The price lookup key is only a fallback,
// so a later standard price with a new lookup key still maps.
export async function resolvePricePlan(stripe, price) {
  const ref = priceRef(price)
  if (!ref) return null
  if (needsPrice(ref) && stripe && stripe.prices && stripe.prices.retrieve) {
    const loaded = await stripe.prices.retrieve(ref.id)
    if (!loaded) return null
    return fromParts(stripe, priceRef(loaded))
  }
  return fromParts(stripe, ref)
}
