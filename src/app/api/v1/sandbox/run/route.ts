import { json, badRequest } from '@/lib/http'
import { engineConfigured } from '@/lib/env'
import { runSandboxSample } from '@/lib/sandbox-demo'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!engineConfigured()) {
    return json({ error: 'MVP engine bridge is not configured.' }, { status: 503 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await runSandboxSample(body)
    return json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest('Invalid sandbox payload', error.flatten())
    }

    return json(
      { error: error instanceof Error ? error.message : 'Sandbox run failed' },
      { status: 500 }
    )
  }
}
