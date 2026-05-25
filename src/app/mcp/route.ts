import { json } from '@/lib/http'
import { env } from '@/lib/env'
import { buildMcpManifest, buildMcpTools } from '@/lib/x402/mcp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return json(buildMcpManifest())
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const id = body?.id ?? null

  if (body?.method === 'initialize') {
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'co2router-x402', version: '1.0.0' },
      },
    })
  }

  if (body?.method === 'tools/list') {
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: buildMcpTools(),
      },
    })
  }

  if (body?.method === 'tools/call') {
    const name = body?.params?.name
    const tool = buildMcpTools().find((candidate) => candidate.name === name)
    if (!tool) {
      return json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Unknown CO2 Router tool' },
      })
    }
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: `Call ${tool.x402.method} ${tool.x402.path} through ${env.CO2ROUTER_X402_PUBLIC_URL} and include a valid x402 payment for ${tool.x402.price}.`,
          },
        ],
        structuredContent: tool,
      },
    })
  }

  return json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  })
}
