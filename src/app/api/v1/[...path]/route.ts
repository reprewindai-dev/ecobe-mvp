import crypto from 'crypto'

import { NextResponse } from 'next/server'

import { corsHeaders } from '@/lib/http'
import { env, engineConfigured, getEngineBaseUrl } from '@/lib/env'

const FORWARDED_HEADERS = ['accept', 'content-type', 'x-request-id', 'x-ecobe-signature'] as const
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]
const SIGNED_DECISION_PATHS = new Set(['ci/route', 'ci/authorize', 'ci/carbon-route'])
const FORWARDED_PATH_PREFIXES = [
  'health',
  'ready',
  'methodology',
  'dashboard',
  'system',
  'ci',
  'intelligence',
  'integrations/dekes',
  'forecasting',
  'route',
  'energy',
  'patterns',
  'disclosure',
  'water',
  'carbon-ledger',
  'dks',
  'adapters',
]
const BLOCKED_PATH_PREFIXES = [
  'internal',
  'events',
  'integrations/webhooks',
  'integrations/events/outbox',
  'organizations',
  'doctrine',
]

function getDecisionApiSignatureSecret() {
  const raw = process.env.DECISION_API_SIGNATURE_SECRET ?? ''
  const cleaned = raw
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]+/g, '')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

function signDecisionBody(body: Buffer) {
  const secret = getDecisionApiSignatureSecret()
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function isProxyPathAllowed(joinedPath: string) {
  const normalized = joinedPath.replace(/^\/+/, '')
  if (!normalized) return false

  if (BLOCKED_PATH_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return false
  }

  return FORWARDED_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  )
}

function getEngineTimeoutMs() {
  const raw = process.env.ECOBE_ENGINE_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 12_000
  return Math.min(Math.max(parsed, 2_000), 60_000)
}

async function proxy(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!engineConfigured()) {
    return NextResponse.json(
      {
        error: 'Broker target is not configured. Set ECOBE_ENGINE_URL.',
      },
      { status: 503, headers: corsHeaders() },
    )
  }

  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl) {
    return NextResponse.json(
      {
        error: 'Broker target is not configured. Set ECOBE_ENGINE_URL.',
      },
      { status: 503, headers: corsHeaders() },
    )
  }

  const { path = [] } = await ctx.params
  const joinedPathRaw = path.join('/')
  if (!isProxyPathAllowed(joinedPathRaw)) {
    return NextResponse.json(
      {
        error: `Path is not exposed by the ecobe-mvp broker: /api/v1/${joinedPathRaw}`,
      },
      { status: 404, headers: corsHeaders() },
    )
  }

  const joinedPath = path.map((part) => encodeURIComponent(part)).join('/')
  const targetUrl = new URL(`${engineBaseUrl}/api/v1/${joinedPath}${new URL(request.url).search}`)
  const headers = new Headers()

  for (const header of FORWARDED_HEADERS) {
    const value = request.headers.get(header)
    if (value) headers.set(header, value)
  }

  if (!env.ECOBE_ENGINE_INTERNAL_KEY) {
    return NextResponse.json(
      {
        error: 'Engine internal auth key is not configured on ecobe-mvp.',
      },
      { status: 503, headers: corsHeaders() },
    )
  }

  headers.set('authorization', `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`)
  headers.set('x-ecobe-internal-key', env.ECOBE_ENGINE_INTERNAL_KEY)
  headers.set('x-api-key', env.ECOBE_ENGINE_INTERNAL_KEY)
  headers.set('x-ecobe-broker-id', env.ECOBE_BROKER_ID)

  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer())

  if (
    bodyBuffer &&
    SIGNED_DECISION_PATHS.has(joinedPathRaw) &&
    !headers.has('x-ecobe-signature')
  ) {
    const signature = signDecisionBody(bodyBuffer)
    if (signature) {
      headers.set('x-ecobe-signature', `v1=${signature}`)
    }
  }

  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), getEngineTimeoutMs())

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: bodyBuffer,
      cache: 'no-store',
      signal: timeoutController.signal,
      redirect: 'manual',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Upstream broker request failed',
      },
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
  responseHeaders.set('x-ecobe-upstream-base', engineBaseUrl)

  const responseBody = await upstream.arrayBuffer()
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

export async function GET(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, ctx)
}

export async function POST(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, ctx)
}

export async function PUT(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, ctx)
}

export async function PATCH(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, ctx)
}

export async function DELETE(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, ctx)
}
