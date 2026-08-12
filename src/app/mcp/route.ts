import { timingSafeEqual } from 'node:crypto'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { createEngineTransport } from '@/lib/engine/engine-client'
import { env } from '@/lib/env'
import { loadLocalEntitlement } from '@/lib/license/license-loader'
import { createCo2RouterMcpServer } from '@/lib/mcp/server-factory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_REQUEST_BYTES = 1_048_576

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

function validBearer(request: Request) {
  if (!env.CO2ROUTER_MCP_HTTP_TOKEN) return false
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const expectedBuffer = Buffer.from(env.CO2ROUTER_MCP_HTTP_TOKEN)
  const providedBuffer = Buffer.from(provided)
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  )
}

function validOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  return env.CO2ROUTER_MCP_ALLOWED_ORIGINS.includes(origin)
}

async function boundedRequest(request: Request) {
  if (request.method !== 'POST') return request
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_REQUEST_BYTES) return null
  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_REQUEST_BYTES) return null
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  })
}

async function handleMcp(request: Request) {
  if (!env.CO2ROUTER_MCP_HTTP_TOKEN) {
    return jsonError(503, 'CO2 Router MCP HTTP authentication is not configured')
  }
  if (!validBearer(request)) return jsonError(401, 'Unauthorized')
  if (!validOrigin(request)) return jsonError(403, 'Origin is not allowed')
  const safeRequest = await boundedRequest(request)
  if (!safeRequest) return jsonError(413, 'MCP request exceeds 1 MiB')

  try {
    const entitlement = await loadLocalEntitlement()
    const server = createCo2RouterMcpServer({ entitlement, engine: createEngineTransport() })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    const response = await transport.handleRequest(safeRequest)
    response.headers.set('cache-control', 'no-store')
    return response
  } catch (error) {
    return jsonError(
      503,
      error instanceof Error ? error.message : 'CO2 Router MCP runtime unavailable',
    )
  }
}

export const GET = handleMcp
export const POST = handleMcp
export const DELETE = handleMcp
