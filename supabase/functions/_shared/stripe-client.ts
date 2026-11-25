import Stripe from 'npm:stripe@23.2.0'
import { assertStripeKeyAllowed } from './billing-guard.mjs'

// Node SDK 23 exports the client class as Stripe. One instance per call.
// The API version is pinned. There is no global api key.
const StripeClient = Stripe
const API_VERSION = '2026-11-18.endive'

export function readStripeEnv(): { key: string; testMode: string; webhookSecret: string } {
  return {
    key: Deno.env.get('STRIPE_SECRET_KEY') || '',
    testMode: Deno.env.get('TEST_MODE') || '',
    webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
  }
}

export function stripeClient(key: string, testMode: string): Stripe {
  assertStripeKeyAllowed(key, testMode)
  return new StripeClient(key, {
    apiVersion: API_VERSION,
    httpClient: Stripe.createFetchHttpClient()
  })
}

export function webhookCrypto(): ReturnType<typeof Stripe.createSubtleCryptoProvider> {
  return Stripe.createSubtleCryptoProvider()
}

export { Stripe }
