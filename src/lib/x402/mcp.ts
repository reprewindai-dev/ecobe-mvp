import { co2RouterX402RouteMeta } from '@/lib/x402/routes'
import { env } from '@/lib/env'

function toolNameFromId(id: string) {
  return `co2router_${id.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`
}

export function buildMcpTools() {
  return co2RouterX402RouteMeta.map((route) => ({
    name: toolNameFromId(route.id),
    description: route.description,
    inputSchema:
      route.inputSchema ??
      route.pathParamsSchema ?? {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    annotations: {
      title: route.description,
      readOnlyHint: route.method === 'GET',
      destructiveHint: false,
      idempotentHint: route.method === 'GET',
      openWorldHint: true,
    },
    x402: {
      method: route.method,
      path: route.path,
      price: route.price,
      network: env.CO2ROUTER_X402_NETWORK,
      resource: `${env.CO2ROUTER_X402_PUBLIC_URL}${route.path}`,
    },
  }))
}

export function buildMcpManifest() {
  return {
    name: 'CO2 Router x402 Governance Gateway',
    version: '1.0.0',
    description:
      'Paid pre-execution governance for autonomous agents, AI workloads, CI/CD jobs, and cloud routing.',
    endpoints: {
      mcp: env.CO2ROUTER_MCP_PUBLIC_URL,
      x402: env.CO2ROUTER_X402_PUBLIC_URL,
      api: 'https://api.co2router.com',
      site: 'https://co2router.com',
    },
    tools: buildMcpTools(),
  }
}
