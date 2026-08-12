import { z } from 'zod'

export type ToolRiskClass = 'READ' | 'SIMULATE'

export type EngineRequest = {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}

export type Co2RouterToolDefinition<T = unknown> = {
  name: string
  title: string
  description: string
  requiredScope: string
  riskClass: ToolRiskClass
  mutatesInfrastructure: false
  input: z.ZodType<T>
  inputJsonSchema: Record<string, unknown>
  engineRequest: (input: T) => EngineRequest
}

const routeJsonSchema = {
  type: 'object',
  properties: {
    workloadId: { type: 'string', minLength: 1 },
    allowedRegions: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
    estimatedEnergyKwh: { type: 'number', minimum: 0 },
    maxLatencyMs: { type: 'number', minimum: 0 },
    policy: { type: 'object' },
  },
  required: ['allowedRegions', 'estimatedEnergyKwh'],
  additionalProperties: false,
} as const

const frameJsonSchema = {
  type: 'object',
  properties: { frameId: { type: 'string', minLength: 1 } },
  required: ['frameId'],
  additionalProperties: false,
} as const

const routeInput = z
  .object({
    workloadId: z.string().min(1).optional(),
    allowedRegions: z.array(z.string().min(1)).min(1),
    estimatedEnergyKwh: z.number().nonnegative(),
    maxLatencyMs: z.number().nonnegative().optional(),
    policy: z.record(z.unknown()).optional(),
  })
  .strict()

const frameInput = z.object({ frameId: z.string().min(1) }).strict()

function framePath(frameId: string, suffix: 'trace' | 'replay') {
  return `ci/decisions/${encodeURIComponent(frameId)}/${suffix}`
}

export const CO2_ROUTER_TOOLS = Object.freeze([
  {
    name: 'co2router_route',
    title: 'Route a workload',
    description:
      'Return a governed environmental routing decision across explicitly allowed regions.',
    requiredScope: 'route:simulate',
    riskClass: 'SIMULATE',
    mutatesInfrastructure: false,
    input: routeInput,
    inputJsonSchema: routeJsonSchema,
    engineRequest: (input: z.infer<typeof routeInput>) => ({
      method: 'POST',
      path: 'ci/route',
      body: input,
    }),
  },
  {
    name: 'co2router_explain',
    title: 'Explain a decision',
    description: 'Fetch the recorded trace that explains a CO2 Router decision frame.',
    requiredScope: 'proof:read',
    riskClass: 'READ',
    mutatesInfrastructure: false,
    input: frameInput,
    inputJsonSchema: frameJsonSchema,
    engineRequest: ({ frameId }: z.infer<typeof frameInput>) => ({
      method: 'GET',
      path: framePath(frameId, 'trace'),
    }),
  },
  {
    name: 'co2router_proof',
    title: 'Read decision proof',
    description: 'Fetch proof, provenance, and replay state for a CO2 Router decision frame.',
    requiredScope: 'proof:read',
    riskClass: 'READ',
    mutatesInfrastructure: false,
    input: frameInput,
    inputJsonSchema: frameJsonSchema,
    engineRequest: ({ frameId }: z.infer<typeof frameInput>) => ({
      method: 'GET',
      path: framePath(frameId, 'replay'),
    }),
  },
  {
    name: 'co2router_replay',
    title: 'Replay a decision',
    description: 'Fetch deterministic replay material for a recorded CO2 Router decision frame.',
    requiredScope: 'replay:read',
    riskClass: 'READ',
    mutatesInfrastructure: false,
    input: frameInput,
    inputJsonSchema: frameJsonSchema,
    engineRequest: ({ frameId }: z.infer<typeof frameInput>) => ({
      method: 'GET',
      path: framePath(frameId, 'replay'),
    }),
  },
] satisfies readonly Co2RouterToolDefinition<any>[])

export function getToolDefinition(name: string) {
  return CO2_ROUTER_TOOLS.find((tool) => tool.name === name)
}
