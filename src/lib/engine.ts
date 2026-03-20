import { env } from './env'

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
  try {
    return await fetchJson(`${env.ECOBE_ENGINE_URL}/internal/v1/routing-decisions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new Error(`Engine routing decision failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function executeAllocation(decisionId: string) {
  try {
    return await fetchJson(`${env.ECOBE_ENGINE_URL}/internal/v1/routing-decisions/${decisionId}/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
    })
  } catch (error) {
    throw new Error(`Engine allocation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function getEngineHealth() {
  try {
    return await fetchJson(`${env.ECOBE_ENGINE_URL}/internal/v1/health`, {
      headers: {
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
    })
  } catch (error) {
    return {
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
