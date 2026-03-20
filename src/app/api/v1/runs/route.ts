import { z } from 'zod'

import { authenticateApiKey } from '@/lib/auth'
import { badRequest, unauthorized, json } from '@/lib/http'
import { orchestrateRun } from '@/lib/run-orchestrator'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  environmentSlug: z.string().optional(),
  input: z.record(z.any()),
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
  output: z.record(z.any()).optional(),
})

export async function POST(request: Request) {
  const apiKey = await authenticateApiKey(request)
  if (!apiKey) {
    return unauthorized()
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid run payload', parsed.error.flatten())
  }

  const envelope = await orchestrateRun(apiKey, parsed.data)
  return json(envelope, { status: envelope.status === 'completed' ? 201 : 200 })
}
