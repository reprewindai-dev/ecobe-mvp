import type { HTTPAdapter, HTTPResponseInstructions } from '@x402/core/http'

import { corsHeaders, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { getX402RouteMetaByPath } from '@/lib/x402/routes'
import { getX402Server, x402GatewayConfigured } from '@/lib/x402/server'

class RequestAdapter implements HTTPAdapter {
  constructor(
    private readonly request: Request,
    private readonly body?: unknown,
  ) {}

  getHeader(name: string) {
    return this.request.headers.get(name) ?? undefined
  }

  getMethod() {
    return this.request.method
  }

  getPath() {
    return new URL(this.request.url).pathname
  }

  getUrl() {
    return this.request.url
  }

  getAcceptHeader() {
    return this.request.headers.get('accept') ?? ''
  }

  getUserAgent() {
    return this.request.headers.get('user-agent') ?? ''
  }

  getQueryParams() {
    const params = new URL(this.request.url).searchParams
    const result: Record<string, string | string[]> = {}
    params.forEach((_value, key) => {
      const values = params.getAll(key)
      result[key] = values.length > 1 ? values : values[0] ?? ''
    })
    return result
  }

  getQueryParam(name: string) {
    const values = new URL(this.request.url).searchParams.getAll(name)
    if (values.length === 0) return undefined
    return values.length === 1 ? values[0] : values
  }

  getBody() {
    return this.body
  }
}

function responseFromInstructions(instructions: HTTPResponseInstructions) {
  const headers = corsHeaders(instructions.headers)
  const body =
    typeof instructions.body === 'string'
      ? instructions.body
      : JSON.stringify(instructions.body ?? {})

  if (!headers.has('content-type')) {
    headers.set('content-type', instructions.isHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8')
  }

  return new Response(body, {
    status: instructions.status,
    headers,
  })
}

async function readBodyForPayment(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const raw = await request.text()
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function recordPaymentEvent(input: {
  request: Request
  routePath: string
  routeMethod: string
  status: 'settled' | 'settlement_failed' | 'handler_failed'
  priceUsd?: number
  payer?: string
  transaction?: string
  network?: string
  decisionFrameId?: string | null
  proofHash?: string | null
  upstreamStatus?: number
  metadata?: unknown
}) {
  try {
    await prisma.x402PaymentEvent.create({
      data: {
        routePath: input.routePath,
        routeMethod: input.routeMethod,
        status: input.status,
        priceUsd: input.priceUsd ?? 0,
        payer: input.payer ?? null,
        transactionHash: input.transaction ?? null,
        network: input.network ?? null,
        decisionFrameId: input.decisionFrameId ?? null,
        proofHash: input.proofHash ?? null,
        upstreamStatus: input.upstreamStatus ?? null,
        userAgent: input.request.headers.get('user-agent'),
        metadata: input.metadata ?? {},
      },
    })
  } catch (error) {
    console.warn('CO2 Router x402 payment event logging failed', error)
  }
}

function extractResponseIds(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return { decisionFrameId: null, proofHash: null }
  }
  const data = payload as Record<string, unknown>
  const response = typeof data.response === 'object' && data.response ? (data.response as Record<string, unknown>) : data
  return {
    decisionFrameId:
      String(
        response.decisionFrameId ??
          response.frameId ??
          response.id ??
          data.decisionFrameId ??
          '',
      ) || null,
    proofHash:
      String(
        response.proofHash ??
          data.proofHash ??
          (typeof response.proof === 'object' && response.proof
            ? (response.proof as Record<string, unknown>).proofHash
            : '') ??
          '',
      ) || null,
  }
}

export async function handleX402Request(
  request: Request,
  handler: (body: unknown) => Promise<Response>,
) {
  if (!x402GatewayConfigured()) {
    return json(
      {
        error: 'CO2 Router x402 gateway is not configured',
        detail: 'Set CO2ROUTER_PAY_TO in Coolify for the broker service.',
      },
      { status: 503 },
    )
  }

  const body = await readBodyForPayment(request)
  const url = new URL(request.url)
  const routeMeta = getX402RouteMetaByPath(request.method, url.pathname)
  const adapter = new RequestAdapter(request, body)
  const server = await getX402Server()
  const paymentResult = await server.processHTTPRequest({
    adapter,
    path: adapter.getPath(),
    method: request.method,
    paymentHeader:
      request.headers.get('payment-signature') ??
      request.headers.get('PAYMENT-SIGNATURE') ??
      request.headers.get('x-payment') ??
      undefined,
  })

  if (paymentResult.type === 'payment-error') {
    return responseFromInstructions(paymentResult.response)
  }

  if (paymentResult.type !== 'payment-verified') {
    return json({ error: 'x402 payment was not verified for this route' }, { status: 402 })
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await handler(body)
  } catch (error) {
    await paymentResult.cancellationDispatcher.cancel({
      reason: 'handler_threw',
      error,
    })
    await recordPaymentEvent({
      request,
      routePath: url.pathname,
      routeMethod: request.method,
      status: 'handler_failed',
      priceUsd: routeMeta?.price ? Number(routeMeta.price.replace('$', '')) : 0,
      metadata: { error: error instanceof Error ? error.message : 'Unknown handler error' },
    })
    throw error
  }

  const responseHeaders: Record<string, string> = {}
  upstreamResponse.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer())

  if (upstreamResponse.status >= 500) {
    await paymentResult.cancellationDispatcher.cancel({
      reason: 'handler_failed',
      responseStatus: upstreamResponse.status,
    })
    await recordPaymentEvent({
      request,
      routePath: url.pathname,
      routeMethod: request.method,
      status: 'handler_failed',
      priceUsd: routeMeta?.price ? Number(routeMeta.price.replace('$', '')) : 0,
      upstreamStatus: upstreamResponse.status,
    })
    return new Response(responseBuffer, {
      status: upstreamResponse.status,
      headers: corsHeaders(responseHeaders),
    })
  }

  const settlement = await server.processSettlement(
    paymentResult.paymentPayload,
    paymentResult.paymentRequirements,
    paymentResult.declaredExtensions,
    {
      request: {
        adapter,
        path: adapter.getPath(),
        method: request.method,
        routePattern: url.pathname,
      },
      responseBody: responseBuffer,
      responseHeaders,
    },
  )

  if (!settlement.success) {
    await recordPaymentEvent({
      request,
      routePath: url.pathname,
      routeMethod: request.method,
      status: 'settlement_failed',
      priceUsd: routeMeta?.price ? Number(routeMeta.price.replace('$', '')) : 0,
      network: settlement.network,
      metadata: {
        errorReason: settlement.errorReason,
        errorMessage: settlement.errorMessage,
      },
    })
    return responseFromInstructions(settlement.response)
  }

  let parsedPayload: unknown = null
  try {
    parsedPayload = JSON.parse(responseBuffer.toString('utf8'))
  } catch {
    parsedPayload = null
  }
  const ids = extractResponseIds(parsedPayload)
  await recordPaymentEvent({
    request,
    routePath: url.pathname,
    routeMethod: request.method,
    status: 'settled',
    priceUsd: routeMeta?.price ? Number(routeMeta.price.replace('$', '')) : 0,
    payer: settlement.payer,
    transaction: settlement.transaction,
    network: settlement.network,
    decisionFrameId: ids.decisionFrameId,
    proofHash: ids.proofHash,
    upstreamStatus: upstreamResponse.status,
    metadata: { routeId: routeMeta?.id ?? null },
  })

  const finalHeaders = corsHeaders(responseHeaders)
  for (const [key, value] of Object.entries(settlement.headers)) {
    finalHeaders.set(key, value)
  }
  finalHeaders.set('x-co2router-x402', 'settled')

  return new Response(responseBuffer, {
    status: upstreamResponse.status,
    headers: finalHeaders,
  })
}
