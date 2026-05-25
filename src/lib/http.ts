function corsHeaderValue(headers: Headers, name: string, value: string) {
  headers.set(name, value)
}

export function corsHeaders(init?: HeadersInit) {
  const headers = new Headers(init)
  corsHeaderValue(headers, 'Access-Control-Allow-Origin', '*')
  corsHeaderValue(headers, 'Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  corsHeaderValue(
    headers,
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, X-ECOBE-Internal-Key, X-ECOBE-Signature, X-Request-Id, X-API-Key, Accept, PAYMENT-SIGNATURE, X-PAYMENT',
  )
  corsHeaderValue(headers, 'Access-Control-Expose-Headers', 'x-ecobe-broker, x-ecobe-upstream, PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE')
  corsHeaderValue(headers, 'Vary', 'Origin')
  corsHeaderValue(headers, 'Access-Control-Max-Age', '86400')
  return headers
}

export function json(data: unknown, init?: ResponseInit) {
  const headers = corsHeaders(init?.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function badRequest(message: string, details?: unknown) {
  return json({ error: message, details }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized') {
  return json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return json({ error: message }, { status: 403 })
}

export function notFound(message = 'Not found') {
  return json({ error: message }, { status: 404 })
}
