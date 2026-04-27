import { env, engineConfigured, getEngineBaseUrl } from './env'

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }

  return response.json()
}

export async function createRoutingDecision(payload: Record<string, any>) {
  if (!engineConfigured()) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }
  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }

  try {
    return await fetchJson(`${engineBaseUrl}/api/v1/routing-decisions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new Error(
      `Engine routing decision failed against ${engineBaseUrl}/api/v1/routing-decisions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function executeAllocation(decisionId: string) {
  if (!engineConfigured()) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }
  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }

  try {
    return await fetchJson(`${engineBaseUrl}/api/v1/routing-decisions/${decisionId}/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
    })
  } catch (error) {
    throw new Error(
      `Engine allocation failed against ${engineBaseUrl}/api/v1/routing-decisions/${decisionId}/execute: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function getEngineHealth() {
  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl) {
    return {
      status: 'unreachable',
      error: 'ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.',
      upstream: null,
    }
  }

  try {
    return await fetchJson(`${engineBaseUrl}/api/v1/health`, {
      headers: {
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
    })
  } catch (error) {
    return {
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
      upstream: `${engineBaseUrl}/api/v1/health`,
    }
  }
}
