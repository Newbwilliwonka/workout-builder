// Hosted Checkout for an approved, signed-in person.
// The browser sends a plan id only. Price ids are resolved here by lookup key.
// Do not deploy until William says so. No Stripe key belongs in this file.
import { withSupabase } from 'npm:@supabase/server@1'
import { bridgeServiceRole } from '../_shared/stripe-env.ts'
import { readStripeEnv, stripeClient } from '../_shared/stripe-client.ts'
import { BillingError, publicMessage, safeLog } from '../_shared/billing-guard.mjs'
import { createCheckoutSession, planFromBody } from '../_shared/billing-checkout.mjs'
import { applyCors, preflightResponse } from '../_shared/billing-cors.mjs'

bridgeServiceRole()

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  })
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message || '')
  return ''
}

const authed = withSupabase({ auth: 'user', cors: 'disabled' }, async (req, ctx) => {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })
    const userId = ctx.userClaims && ctx.userClaims.id
    const env = readStripeEnv()
    let body: unknown = {}
    try {
      body = await req.json()
    } catch (_err) {
      body = {}
    }
    const admin = ctx.supabaseAdmin
    try {
      const stripe = stripeClient(env.key, env.testMode)
      const result = await createCheckoutSession({
        stripe: stripe,
        secretKey: env.key,
        testMode: env.testMode,
        userId: userId,
        email: ctx.userClaims && ctx.userClaims.email,
        plan: planFromBody(body),
        log: function (fields: Record<string, string>) {
          safeLog(function (safe: Record<string, string>) { console.log(JSON.stringify(safe)) }, fields)
        },
        db: {
          loadProfile: async function (id: string) {
            const { data, error } = await admin
              .from('profiles')
              .select('id, access_approved, beta_locked, stripe_customer_id, complimentary, stripe_subscription_id, billing_status')
              .eq('id', id)
              .maybeSingle()
            if (error) throw new BillingError('Checkout could not be started.', 500)
            return data
          },
          rpc: async function (name: string, args: Record<string, unknown>) {
            const { data, error } = await admin.rpc(name, args)
            if (error) throw new Error(messageOf(error))
            return data
          }
        }
      })
      return json(result.status, result.body)
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 500
      return json(status || 500, { error: publicMessage(err, 'Checkout could not be started.') })
    }
  })

export default {
  fetch: async (req: Request, ctx?: unknown) => {
    if (req.method === 'OPTIONS') return preflightResponse(req.headers.get('origin'))
    const response = await authed(req, ctx)
    return applyCors(req, response)
  }
}
