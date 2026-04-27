import { json } from '@/lib/http'

import { env, engineConfigured, getEngineBaseUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

type EngineHealthResponse = {
  timestamp?: string
  providers?: Record<string, boolean>
}

export async function GET() {
  if (!engineConfigured()) {
    return json(
      { error: 'ECOBE engine broker is not configured.' },
      { status: 503 },
    )
  }

  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl) {
    return json(
      { error: 'ECOBE engine broker is not configured.' },
      { status: 503 },
    )
  }

  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
    'x-ecobe-internal-key': env.ECOBE_ENGINE_INTERNAL_KEY,
    'x-api-key': env.ECOBE_ENGINE_INTERNAL_KEY,
  })

  try {
    const response = await fetch(`${engineBaseUrl}/api/v1/health`, {
      headers,
      cache: 'no-store',
    })

    const health = (await response.json().catch(() => ({}))) as EngineHealthResponse & Record<string, unknown>

    return json(health, {
      status: response.status,
      headers: {
        'x-ecobe-broker': 'ecobe-mvp',
        'x-ecobe-upstream': 'engine-health',
        'x-ecobe-upstream-base': engineBaseUrl,
      },
    })
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Engine health unavailable' },
      { status: 502 },
    )
  }
}
