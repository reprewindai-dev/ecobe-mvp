import { declareDiscoveryExtension } from '@x402/extensions/bazaar'
import type { RoutesConfig } from '@x402/core/server'

import { env } from '@/lib/env'

export type X402RouteId =
  | 'authorize'
  | 'route'
  | 'run'
  | 'runEvents'
  | 'proof'
  | 'gridSummary'
  | 'gridRegion'
  | 'complianceReport'

type RouteMeta = {
  id: X402RouteId
  method: 'GET' | 'POST'
  path: string
  price: string
  description: string
  tags: string[]
  input?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  pathParams?: Record<string, unknown>
  pathParamsSchema?: Record<string, unknown>
  outputExample: Record<string, unknown>
}

const workloadInputSchema = {
  type: 'object',
  properties: {
    preferredRegions: { type: 'array', items: { type: 'string' }, minItems: 1 },
    decisionMode: {
      type: 'string',
      enum: ['runtime_authorization', 'planning', 'compliance_check'],
    },
    jobType: { type: 'string' },
    criticality: { type: 'string', enum: ['low', 'standard', 'high', 'critical'] },
    allowDelay: { type: 'boolean' },
    estimatedEnergyKwh: { type: 'number', minimum: 0 },
  },
  required: ['preferredRegions', 'decisionMode', 'jobType', 'criticality', 'estimatedEnergyKwh'],
  additionalProperties: true,
}

const routeInputSchema = {
  type: 'object',
  properties: {
    workloadId: { type: 'string' },
    allowedRegions: { type: 'array', items: { type: 'string' }, minItems: 1 },
    estimatedEnergyKwh: { type: 'number', minimum: 0 },
    maxLatencyMs: { type: 'number', minimum: 0 },
    policy: { type: 'object' },
  },
  required: ['allowedRegions', 'estimatedEnergyKwh'],
  additionalProperties: true,
}

export const co2RouterX402RouteMeta: RouteMeta[] = [
  {
    id: 'authorize',
    method: 'POST',
    path: '/x402/v1/authorize',
    price: '$0.04',
    description:
      'Authorize a compute, AI, CI/CD, or cloud workload before execution. Returns one binding governance action, selected region, reason code, and replayable proof hash.',
    tags: ['pre-execution-governance', 'ai-workload-routing', 'proofhash', 'cloud'],
    input: {
      preferredRegions: ['us-east-1', 'us-west-2'],
      decisionMode: 'runtime_authorization',
      jobType: 'batch_compute',
      criticality: 'standard',
      allowDelay: true,
      estimatedEnergyKwh: 12.5,
    },
    inputSchema: workloadInputSchema,
    outputExample: {
      decision: 'delay',
      selectedRegion: 'us-west-2',
      reasonCode: 'SEKED_POLICY_RED_ZONE',
      proofHash: 'sha256:...',
    },
  },
  {
    id: 'route',
    method: 'POST',
    path: '/x402/v1/route',
    price: '$0.01',
    description:
      'Return a governed low-carbon routing decision across allowed regions using carbon, water, latency, cost, and policy signals.',
    tags: ['green-routing', 'cloud-region-selection', 'carbon', 'water', 'latency'],
    input: {
      allowedRegions: ['us-east-1', 'us-west-2', 'ca-qc'],
      estimatedEnergyKwh: 4.2,
    },
    inputSchema: routeInputSchema,
    outputExample: {
      action: 'reroute',
      selectedRegion: 'ca-qc',
      proofHash: 'sha256:...',
    },
  },
  {
    id: 'run',
    method: 'GET',
    path: '/x402/v1/runs/:id',
    price: '$0.002',
    description: 'Fetch a governed run or decision frame by id through the CO2 Router broker.',
    tags: ['run-history', 'governance', 'proof'],
    pathParams: { id: 'decision-frame-id' },
    pathParamsSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    outputExample: { decisionFrameId: '...', decision: 'delay', proofHash: 'sha256:...' },
  },
  {
    id: 'runEvents',
    method: 'GET',
    path: '/x402/v1/runs/:id/events',
    price: '$0.002',
    description: 'Fetch trace events for a governed run or decision frame.',
    tags: ['trace', 'events', 'audit'],
    pathParams: { id: 'decision-frame-id' },
    pathParamsSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    outputExample: { data: [{ eventType: 'decision.finalized', createdAt: '2026-05-25T00:00:00Z' }] },
  },
  {
    id: 'proof',
    method: 'GET',
    path: '/x402/v1/proof/:frameId',
    price: '$0.002',
    description:
      'Fetch proof, trace posture, replay state, and provenance for a CO2 Router decision frame.',
    tags: ['proofhash', 'audit', 'replay', 'provenance'],
    pathParams: { frameId: 'decision-frame-id' },
    pathParamsSchema: {
      type: 'object',
      properties: { frameId: { type: 'string' } },
      required: ['frameId'],
    },
    outputExample: { proofHash: 'sha256:...', replayable: true, provenance: {} },
  },
  {
    id: 'gridSummary',
    method: 'GET',
    path: '/x402/v1/intelligence/grid/summary',
    price: '$0.005',
    description: 'Fetch live CO2 Router grid intelligence coverage and route-source summary.',
    tags: ['grid-intelligence', 'coverage', 'routes'],
    outputExample: { active: 11, needsKey: 1, needsConnector: 29 },
  },
  {
    id: 'gridRegion',
    method: 'GET',
    path: '/x402/v1/intelligence/grid/region/:region',
    price: '$0.01',
    description: 'Fetch live/source-backed grid intelligence for one CO2 Router region.',
    tags: ['grid-intelligence', 'region', 'carbon', 'water'],
    pathParams: { region: 'US-TEX-ERCO' },
    pathParamsSchema: {
      type: 'object',
      properties: { region: { type: 'string' } },
      required: ['region'],
    },
    outputExample: { region: 'US-TEX-ERCO', carbonIntensity: 397, source: 'EIA930_FUEL_MIX_IPCC' },
  },
  {
    id: 'complianceReport',
    method: 'POST',
    path: '/x402/v1/compliance/report',
    price: '$0.50',
    description:
      'Generate a proof export batch for recent CO2 Router decisions for audit and governance reporting.',
    tags: ['compliance', 'audit-export', 'governance', 'proof'],
    input: { limit: 25 },
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 1000 } },
      additionalProperties: false,
    },
    outputExample: { batchId: 'ci-proof-...', batchHash: 'sha256:...', exportedRecords: 25 },
  },
]

function routeResourceUrl(path: string) {
  return `${env.CO2ROUTER_X402_PUBLIC_URL}${path}`
}

export function getX402RouteMetaByPath(method: string, path: string) {
  return co2RouterX402RouteMeta.find((route) => {
    if (route.method !== method.toUpperCase()) return false
    const pattern = new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`, 'i')
    return pattern.test(path)
  })
}

export function buildCo2RouterX402Routes(): RoutesConfig {
  if (!env.CO2ROUTER_PAY_TO) {
    return {}
  }

  return Object.fromEntries(
    co2RouterX402RouteMeta.map((route) => {
      const discovery =
        route.method === 'POST'
          ? declareDiscoveryExtension({
              bodyType: 'json',
              input: route.input,
              inputSchema: route.inputSchema,
              output: { example: route.outputExample },
            })
          : declareDiscoveryExtension({
              input: route.input,
              inputSchema: route.inputSchema,
              pathParams: route.pathParams,
              pathParamsSchema: route.pathParamsSchema,
              output: { example: route.outputExample },
            })

      return [
        `${route.method} ${route.path}`,
        {
          resource: routeResourceUrl(route.path),
          accepts: [
            {
              scheme: 'exact',
              price: route.price,
              network: env.CO2ROUTER_X402_NETWORK,
              payTo: env.CO2ROUTER_PAY_TO,
            },
          ],
          description: route.description,
          mimeType: 'application/json',
          extensions: discovery,
          unpaidResponseBody: () => ({
            contentType: 'application/json',
            body: {
              error: 'x402 payment required',
              service: 'CO2 Router x402 Governance Gateway',
              route: route.path,
              price: route.price,
              network: env.CO2ROUTER_X402_NETWORK,
              description: route.description,
            },
          }),
        },
      ]
    }),
  ) as RoutesConfig
}
