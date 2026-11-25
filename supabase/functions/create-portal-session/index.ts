// Hosted Customer Portal for the signed-in person's own Stripe customer.
// A customer id in the request body is ignored. Do not deploy until William says so.
import { withSupabase } from 'npm:@supabase/server@1'
import { bridgeServiceRole } from '../_shared/stripe-env.ts'
import { readStripeEnv, stripeClient } from '../_shared/stripe-client.ts'
import { BillingError, publicMessage } from '../_shared/billing-guard.mjs'
import { createPortalSession } from '../_shared/billing-portal.mjs'

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

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })
    const env = readStripeEnv()
    const userId = ctx.userClaims && ctx.userClaims.id
    try {
      const stripe = stripeClient(env.key, env.testMode)
      const result = await createPortalSession({
        stripe: stripe,
        secretKey: env.key,
        testMode: env.testMode,
        userId: userId,
        portalBeta: Deno.env.get('STRIPE_PORTAL_BETA_CONFIGURATION') || '',
        portalStandard: Deno.env.get('STRIPE_PORTAL_STANDARD_CONFIGURATION') || '',
        db: {
          loadProfile: async function (id: string) {
            const { data, error } = await ctx.supabase
              .from('profiles')
              .select('stripe_customer_id, beta_locked')
              .eq('id', id)
              .maybeSingle()
            if (error) throw new BillingError('The billing page could not be opened.', 500)
            return data
          }
        }
      })
      return json(result.status, result.body)
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 500
      return json(status || 500, { error: publicMessage(err, 'The billing page could not be opened.') })
    }
  })
}
