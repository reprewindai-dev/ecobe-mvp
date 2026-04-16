import { z } from 'zod'

export const PublicRunRequestSchema = z.object({
  environment: z.string().min(1),
  workload: z.object({
    type: z.enum(['inference', 'batch', 'classification', 'other']),
    operation: z.string().min(1),
    input: z.record(z.unknown()),
    schema: z.record(z.unknown()).optional(),
    model: z.string().optional(),
    temperature: z.number().optional(),
    estimatedUsage: z.object({
      tokenCount: z.number().int().nonnegative().optional(),
      requestCount: z.number().int().nonnegative().optional(),
    }).optional(),
  }),
  constraints: z.object({
    latencyMs: z.number().int().positive().optional(),
    costUsd: z.number().nonnegative().optional(),
    carbon: z.object({
      maxCarbonGPerKwh: z.number().nonnegative().optional(),
    }).optional(),
    water: z.object({
      mode: z.enum(['ignore', 'prefer_low', 'enforce']).optional(),
    }).optional(),
    energy: z.object({
      preference: z.enum(['default', 'renewable_preferred', 'low_intensity']).optional(),
    }).optional(),
  }).optional(),
  targets: z.object({
    providers: z.array(z.string()).optional(),
    preferredRegions: z.array(z.string()).optional(),
  }).optional(),
  metadata: z.object({
    requestId: z.string().optional(),
    customerRef: z.string().optional(),
    traceId: z.string().optional(),
    projectId: z.string().optional(),
    projectSlug: z.string().optional(),
  }).optional(),
})

export const LegacyRunRequestSchema = z.object({
  environmentSlug: z.string().optional(),
  projectId: z.string().optional(),
  input: z.record(z.unknown()),
  providerConstraints: z.object({
    preferredRegions: z.array(z.string()).optional(),
    providers: z.array(z.string()).optional(),
  }).optional(),
  latencyCeiling: z.number().positive().optional(),
  costCeiling: z.number().positive().optional(),
  carbonPolicy: z.object({
    maxCarbonGPerKwh: z.number().positive().optional(),
  }).optional(),
  model: z.string().optional(),
  tokenCount: z.number().positive().optional(),
  requestCount: z.number().positive().optional(),
  operation: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  output: z.record(z.unknown()).optional(),
})

export type ParsedRunRequest =
  | { source: 'public'; value: z.infer<typeof PublicRunRequestSchema> }
  | { source: 'legacy'; value: z.infer<typeof LegacyRunRequestSchema> }

export function parseRunRequestShape(body: unknown): ParsedRunRequest {
  const publicParsed = PublicRunRequestSchema.safeParse(body)
  if (publicParsed.success) {
    return { source: 'public', value: publicParsed.data }
  }

  const legacyParsed = LegacyRunRequestSchema.safeParse(body)
  if (legacyParsed.success) {
    return { source: 'legacy', value: legacyParsed.data }
  }

  throw publicParsed.error
}
