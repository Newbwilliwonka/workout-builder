// In-app plan change for the signed-in person's own Stripe subscription.
// The browser sends a plan id only. Do not deploy until William says so.
// No Stripe key belongs in this file.
import { withSupabase } from 'npm:@supabase/server@1'
import { bridgeServiceRole } from '../_shared/stripe-env.ts'
import { readStripeEnv, stripeClient } from '../_shared/stripe-client.ts'
import { BillingError, publicMessage } from '../_shared/billing-guard.mjs'
import { changeSubscription } from '../_shared/billing-change.mjs'
import { planFromBody } from '../_shared/billing-checkout.mjs'
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
      const result = await changeSubscription({
        stripe: stripe,
        secretKey: env.key,
        testMode: env.testMode,
        userId: userId,
        plan: planFromBody(body),
        db: {
          loadProfile: async function (id: string) {
            const { data, error } = await admin
              .from('profiles')
              .select('id, access_approved, beta_locked, stripe_customer_id, complimentary')
              .eq('id', id)
              .maybeSingle()
            if (error) throw new BillingError('That plan could not be changed.', 500)
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
      return json(status || 500, { error: publicMessage(err, 'That plan could not be changed.') })
    }
  })

export default {
  fetch: async (req: Request, ctx?: unknown) => {
    if (req.method === 'OPTIONS') return preflightResponse(req.headers.get('origin'))
    const response = await authed(req, ctx)
    return applyCors(req, response)
  }
}
