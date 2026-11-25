// Stripe webhooks. JWT verification is off; the Stripe signature is the check.
// Deploy with --no-verify-jwt. Do not deploy until William says so.
// Logs event ids and customer or subscription ids only.
import { withSupabase } from 'npm:@supabase/server@1'
import { bridgeServiceRole } from '../_shared/stripe-env.ts'
import { readStripeEnv, stripeClient, webhookCrypto } from '../_shared/stripe-client.ts'
import { BillingError, publicMessage, safeLog } from '../_shared/billing-guard.mjs'
import { handleWebhook } from '../_shared/billing-webhook.mjs'

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

export default {
  fetch: withSupabase({ auth: 'none', cors: 'disabled' }, async (req, ctx) => {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })
    const env = readStripeEnv()
    const rawBody = await req.text()
    const signature = req.headers.get('stripe-signature') || ''
    const admin = ctx.supabaseAdmin
    try {
      const stripe = stripeClient(env.key, env.testMode)
      const cryptoProvider = webhookCrypto()
      const result = await handleWebhook({
        stripe: stripe,
        secretKey: env.key,
        testMode: env.testMode,
        webhookSecret: env.webhookSecret,
        rawBody: rawBody,
        signature: signature,
        log: function (fields: Record<string, string>) {
          safeLog(function (safe: Record<string, string>) { console.log(JSON.stringify(safe)) }, fields)
        },
        constructEvent: function (raw: string, sig: string, secret: string) {
          return stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, cryptoProvider)
        },
        db: {
          eventSeen: async function (id: string) {
            const { data, error } = await admin.from('stripe_events').select('id').eq('id', id).maybeSingle()
            if (error || !data) return false
            return true
          },
          findProfile: async function (customerId: string | null, userId: string | null) {
            const columns = 'id, complimentary, billing_status, stripe_subscription_id'
            if (customerId) {
              const byCustomer = await admin.from('profiles').select(columns).eq('stripe_customer_id', customerId).maybeSingle()
              if (!byCustomer.error && byCustomer.data) return byCustomer.data
            }
            if (userId) {
              const byUser = await admin.from('profiles').select(columns).eq('id', userId).maybeSingle()
              if (!byUser.error && byUser.data) return byUser.data
            }
            return null
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
      const status = err instanceof BillingError ? err.status : 500
      if (status >= 500) {
        safeLog(function (safe: Record<string, string>) { console.log(JSON.stringify(safe)) }, { result: 'error' })
      }
      return json(status || 500, { error: publicMessage(err, 'Could not update billing.') })
    }
  })
}
