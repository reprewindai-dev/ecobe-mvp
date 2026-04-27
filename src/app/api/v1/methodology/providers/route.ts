import { json } from '@/lib/http'

import { env, engineConfigured, getEngineBaseUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

type EngineHealthResponse = {
  timestamp?: string
  providers?: Record<string, boolean>
}

function formatProviderName(key: string) {
  const aliases: Record<string, string> = {
    watttime: 'WattTime',
    gridstatus: 'GridStatus',
    eia930: 'EIA-930',
    ember: 'Ember',
    gbCarbon: 'GB Carbon',
    dkCarbon: 'DK Carbon',
    fiCarbon: 'FI Carbon',
    static: 'Static Baseline',
    fingrid: 'Fingrid',
  }

  return aliases[key] ?? key
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

    if (!response.ok) {
      return json(
        { error: `Engine health unavailable (${response.status})` },
        { status: response.status },
      )
    }

    const health = (await response.json()) as EngineHealthResponse
    const providers = Object.entries(health.providers ?? {}).map(([key, ready]) => ({
      name: formatProviderName(key),
      status: ready ? 'healthy' : 'offline',
      latencyMs: null,
      lastSuccessAt: ready ? health.timestamp ?? null : null,
      disagreementPct: null,
      computed: key === 'static',
    }))

    return json(
      {
        providers,
      },
      {
        headers: {
          'x-ecobe-broker': 'ecobe-mvp',
          'x-ecobe-upstream': 'engine-health-derived',
          'x-ecobe-upstream-base': engineBaseUrl,
        },
      },
    )
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Provider methodology unavailable',
      },
      { status: 502 },
    )
  }
}
