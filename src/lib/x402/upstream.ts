import crypto from 'crypto'

import { corsHeaders } from '@/lib/http'
import { env, engineConfigured, getEngineBaseUrl } from '@/lib/env'

const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
] as const

const SIGNED_DECISION_PATHS = new Set(['ci/route', 'ci/authorize', 'ci/carbon-route'])

function cleanSignatureSecret() {
  const raw = process.env.DECISION_API_SIGNATURE_SECRET ?? ''
  const cleaned = raw
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]+/g, '')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

function signDecisionBody(body: Buffer) {
  const secret = cleanSignatureSecret()
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function timeoutMs() {
  const parsed = Number(process.env.ECOBE_ENGINE_TIMEOUT_MS ?? '')
  if (!Number.isFinite(parsed) || parsed <= 0) return 12_000
  return Math.min(Math.max(parsed, 2_000), 60_000)
}

export async function proxyX402ToEngine(input: {
  request: Request
  method: 'GET' | 'POST'
  enginePath: string
  search?: string
  body?: unknown
}) {
  if (!engineConfigured()) {
    return new Response(
      JSON.stringify({ error: 'Broker target is not configured. Set ECOBE_ENGINE_URL.' }),
      { status: 503, headers: corsHeaders() },
    )
  }

  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl || !env.ECOBE_ENGINE_INTERNAL_KEY) {
    return new Response(
      JSON.stringify({ error: 'Engine internal auth is not configured on ecobe-mvp.' }),
      { status: 503, headers: corsHeaders() },
    )
  }

  const normalizedPath = input.enginePath.replace(/^\/+/, '')
  const targetUrl = new URL(
    `${engineBaseUrl}/api/v1/${normalizedPath}${input.search ?? ''}`,
  )
  const headers = new Headers()
  const accept = input.request.headers.get('accept')
  const requestId = input.request.headers.get('x-request-id')
  if (accept) headers.set('accept', accept)
  if (requestId) headers.set('x-request-id', requestId)
  headers.set('content-type', 'application/json')
  headers.set('authorization', `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`)
  headers.set('x-ecobe-internal-key', env.ECOBE_ENGINE_INTERNAL_KEY)
  headers.set('x-api-key', env.ECOBE_ENGINE_INTERNAL_KEY)
  headers.set('x-ecobe-broker-id', env.ECOBE_BROKER_ID)

  const bodyBuffer =
    input.method === 'GET'
      ? undefined
      : Buffer.from(JSON.stringify(input.body ?? {}), 'utf8')

  if (bodyBuffer && SIGNED_DECISION_PATHS.has(normalizedPath)) {
    const signature = signDecisionBody(bodyBuffer)
    if (signature) {
      headers.set('x-ecobe-signature', `v1=${signature}`)
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs())

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, {
      method: input.method,
      headers,
      body: bodyBuffer,
      cache: 'no-store',
      signal: controller.signal,
      redirect: 'manual',
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Upstream broker request failed',
      }),
      { status: 502, headers: corsHeaders() },
    )
  } finally {
    clearTimeout(timeout)
  }

  const responseHeaders = corsHeaders(upstream.headers)
  for (const header of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(header)
  }
  responseHeaders.set('x-ecobe-broker', 'ecobe-mvp')
  responseHeaders.set('x-ecobe-upstream', 'engine-internal')
  responseHeaders.set('x-co2router-x402-upstream-path', normalizedPath)

  const responseBody = await upstream.arrayBuffer()
  return new Response(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  })
}
