import { co2RouterX402RouteMeta, type X402RouteId } from '@/lib/x402/routes'
import { env } from '@/lib/env'
import { CO2_ROUTER_TOOLS } from '@/lib/mcp/tool-catalog'

const hostedRouteByTool: Readonly<Record<string, X402RouteId>> = {
  co2router_route: 'route',
  co2router_explain: 'runEvents',
  co2router_proof: 'proof',
  co2router_replay: 'run',
} as const

export function buildMcpTools() {
  return CO2_ROUTER_TOOLS.map((definition) => {
    const routeId = hostedRouteByTool[definition.name]
    const route = co2RouterX402RouteMeta.find((candidate) => candidate.id === routeId)
    if (!route) throw new Error(`Missing x402 metadata for ${definition.name}`)

    return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputJsonSchema,
    annotations: {
      title: definition.title,
      readOnlyHint: definition.riskClass === 'READ',
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
  }
  })
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
