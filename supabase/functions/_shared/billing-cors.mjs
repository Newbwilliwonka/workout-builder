// Browser calls to Checkout and the portal. The webhook does not use this.

const SITE = 'https://coachtrainerapp.com'

export function allowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return null
  if (origin === SITE) return origin
  let url
  try {
    url = new URL(origin)
  } catch (_err) {
    return null
  }
  if (url.protocol !== 'http:') return null
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null
  if (url.username || url.password) return null
  return origin
}

export function corsHeaders(origin) {
  const headers = { vary: 'Origin' }
  const allowed = allowedOrigin(origin)
  if (!allowed) return headers
  headers['access-control-allow-origin'] = allowed
  headers['access-control-allow-methods'] = 'POST, OPTIONS'
  headers['access-control-allow-headers'] = 'authorization, apikey, content-type, x-client-info'
  headers['access-control-max-age'] = '86400'
  return headers
}

export function preflightResponse(origin) {
  const allowed = allowedOrigin(origin)
  return new Response(null, {
    status: allowed ? 204 : 403,
    headers: corsHeaders(origin)
  })
}

export function applyCors(request, response) {
  const origin = request && request.headers && request.headers.get ? request.headers.get('origin') : ''
  const headers = new Headers(response.headers)
  const extra = corsHeaders(origin)
  Object.keys(extra).forEach(function (key) {
    headers.set(key, extra[key])
  })
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  })
}
