import { BillingError, assertStripeKeyAllowed } from './billing-guard.mjs'
import { PORTAL_RETURN_URL } from './billing-plans.mjs'

export async function createPortalSession(input) {
  assertStripeKeyAllowed(input.secretKey, input.testMode)
  if (!input.userId) throw new BillingError('That account was not found.', 401)
  const profile = await input.db.loadProfile(input.userId)
  if (!profile) throw new BillingError('That account was not found.', 404)
  if (profile.access_approved !== true) {
    throw new BillingError('The billing page opens after an admin approves the account.', 403)
  }
  const customer = profile.stripe_customer_id
  if (!customer) throw new BillingError('Billing starts after you subscribe.', 400)

  // No configuration id. Stripe uses the default Customer Portal config.
  const params = {
    customer: customer,
    return_url: PORTAL_RETURN_URL
  }

  let session
  try {
    session = await input.stripe.billingPortal.sessions.create(params)
  } catch (_err) {
    throw new BillingError('The billing page could not be opened.', 502)
  }
  if (!session || !session.url) throw new BillingError('The billing page could not be opened.', 502)
  return { status: 200, body: { url: session.url } }
}
