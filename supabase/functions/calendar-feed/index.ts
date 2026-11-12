// Program calendar feed. Google Calendar fetches this URL with no Supabase key.
// The secret token in the path is the only credential. Do not deploy until the
// calendar_feeds migration has been applied and the owner has approved it.
// Deploy with JWT verification off (supabase/config.toml sets verify_jwt = false):
//   supabase functions deploy calendar-feed --no-verify-jwt
import { withSupabase } from 'npm:@supabase/server@1'
import { buildIcs, tokenFromUrl } from './ics.js'

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff'
}

function notFound() {
  return new Response('This calendar link was not found.', {
    status: 404,
    headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, headers)
  })
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers })
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, headers)
      })
    }
    const token = tokenFromUrl(req.url)
    if (!token) return notFound()
    const { data, error } = await ctx.supabaseAdmin.rpc('calendar_feed_for_token', { p_token: token })
    if (error) {
      console.error('calendar feed lookup failed')
      return notFound()
    }
    let feed = data
    if (typeof feed === 'string') {
      try { feed = JSON.parse(feed) } catch (_e) { feed = null }
    }
    if (!feed || !Array.isArray(feed.events)) return notFound()
    const body = buildIcs(feed)
    const calendarHeaders = Object.assign({
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="program.ics"'
    }, headers)
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: calendarHeaders })
    return new Response(body, { status: 200, headers: calendarHeaders })
  })
}
