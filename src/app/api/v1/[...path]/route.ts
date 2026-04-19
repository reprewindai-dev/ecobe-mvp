import crypto from 'crypto'

import { NextResponse } from 'next/server'

import { corsHeaders } from '@/lib/http'
import { env, engineConfigured } from '@/lib/env'

const FORWARDED_HEADERS = ['accept', 'content-type', 'authorization', 'x-request-id', 'x-ecobe-signature'] as const
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

function getDecisionApiSignatureSecret() {
  return process.env.DECISION_API_SIGNATURE_SECRET ?? null
}

function signDecisionBody(body: Buffer) {
  const secret = getDecisionApiSignatureSecret()
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function shouldUseInternalKey(joinedPath: string) {
  return (
    joinedPath === 'methodology' ||
    joinedPath.startsWith('methodology/') ||
    joinedPath.startsWith('disclosure/') ||
    joinedPath.startsWith('system/') ||
    joinedPath === 'ci/decisions/export' ||
    joinedPath.startsWith('ci/decisions/export/')
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

  const { path = [] } = await ctx.params
  const joinedPath = path.map((part) => encodeURIComponent(part)).join('/')
  const targetUrl = new URL(`${env.ECOBE_ENGINE_URL}/api/v1/${joinedPath}${new URL(request.url).search}`)
  const headers = new Headers()
  const useInternalKey = shouldUseInternalKey(path.join('/'))

  for (const header of FORWARDED_HEADERS) {
    if (useInternalKey && header === 'authorization') continue
    const value = request.headers.get(header)
    if (value) headers.set(header, value)
  }

  if (useInternalKey && env.ECOBE_ENGINE_INTERNAL_KEY) {
    headers.set('authorization', `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`)
    headers.set('x-ecobe-internal-key', env.ECOBE_ENGINE_INTERNAL_KEY)
    headers.set('x-api-key', env.ECOBE_ENGINE_INTERNAL_KEY)
  }

  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer())

  if (
    bodyBuffer &&
    SIGNED_DECISION_PATHS.has(path.join('/')) &&
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
  responseHeaders.set('x-ecobe-upstream', 'engine')

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
