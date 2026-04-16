const baseUrl = process.env.ECOBE_MVP_URL || 'http://localhost:3000'
const adminToken = process.env.ECOBE_ADMIN_TOKEN || 'ecobe-admin-local'
const forbiddenFields = [
  'traceHash',
  'proofHash',
  'previousTraceHash',
  'inputSignalHash',
  'governanceSource',
  'reasonCode',
  'operatingMode',
  'computeMs',
  'cacheHit',
]

async function fetchWithTimeout(url, init, timeoutMs = 30000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  console.log(`Bootstrapping tenant via ${baseUrl}/api/v1/bootstrap`)
  const bootstrapResponse = await fetchWithTimeout(`${baseUrl}/api/v1/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ecobe-admin-token': adminToken,
    },
    body: JSON.stringify({
      organizationName: 'Acme Governance',
      organizationSlug: 'acme-governance',
      projectName: 'Support Copilot',
      projectSlug: 'support-copilot',
      environmentSlug: 'production',
    }),
  }, 30000)

  const bootstrapPayload = await bootstrapResponse.json()
  console.log(`Bootstrap status: ${bootstrapResponse.status}`)
  const apiKey = bootstrapPayload.apiKey
  const serviceAccountKey = bootstrapPayload.serviceAccountKey

  console.log(`Submitting governed run via ${baseUrl}/api/v1/runs`)
  const runResponse = await fetchWithTimeout(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      environmentSlug: 'production',
      input: {
        prompt: 'Summarize this support thread and produce a compliant response.',
      },
      providerConstraints: {
        preferredRegions: ['FR', 'US-EAST-1'],
        providers: ['openai'],
      },
      latencyCeiling: 250,
      costCeiling: 0.08,
      model: 'gpt-4.1',
      tokenCount: 12000,
      output: {
        message: 'Governed run completed.',
      },
    }),
  }, 60000)

  const runPayload = await runResponse.json()
  console.log(`Run status: ${runResponse.status}`)
  console.log(JSON.stringify(runPayload, null, 2))
  assertNoForbiddenFields(runPayload, forbiddenFields)
  assertProofContract(runPayload, 'pro')

  if (runPayload.runId) {
    console.log(`Reading run detail via ${baseUrl}/api/v1/runs/${runPayload.runId}`)
    const runDetailResponse = await fetchWithTimeout(`${baseUrl}/api/v1/runs/${runPayload.runId}`, {
      headers: {
        'x-api-key': apiKey,
      },
    }, 30000)

    const runDetailPayload = await runDetailResponse.json()
    console.log(`Run detail status: ${runDetailResponse.status}`)
    console.log(JSON.stringify(runDetailPayload, null, 2))
    assertNoForbiddenFields(runDetailPayload, forbiddenFields)
    assertProofContract(runDetailPayload, 'pro')

    console.log(`Reading run events via ${baseUrl}/api/v1/runs/${runPayload.runId}/events`)
    const runEventsResponse = await fetchWithTimeout(`${baseUrl}/api/v1/runs/${runPayload.runId}/events`, {
      headers: {
        'x-api-key': apiKey,
      },
    }, 30000)

    const runEventsPayload = await runEventsResponse.json()
    console.log(`Run events status: ${runEventsResponse.status}`)
    console.log(JSON.stringify(runEventsPayload, null, 2))
    assertNoForbiddenFields(runEventsPayload, forbiddenFields)
  }

  console.log(`Reading usage summary via ${baseUrl}/api/v1/usage`)
  const usageResponse = await fetchWithTimeout(`${baseUrl}/api/v1/usage`, {
    headers: {
      'x-api-key': apiKey,
    },
  }, 30000)

  console.log(`Usage status: ${usageResponse.status}`)
  console.log(JSON.stringify(await usageResponse.json(), null, 2))

  console.log(`Reading dashboard overview via ${baseUrl}/api/v1/dashboard/overview`)
  const dashboardResponse = await fetchWithTimeout(`${baseUrl}/api/v1/dashboard/overview`, {
    headers: {
      authorization: `Bearer ${serviceAccountKey}`,
    },
  }, 30000)

  console.log(`Dashboard status: ${dashboardResponse.status}`)
  console.log(JSON.stringify(await dashboardResponse.json(), null, 2))

  console.log(`Reading API key inventory via ${baseUrl}/api/v1/keys`)
  const keysResponse = await fetchWithTimeout(`${baseUrl}/api/v1/keys?organizationSlug=acme-governance`, {
    headers: {
      authorization: `Bearer ${serviceAccountKey}`,
    },
  }, 30000)

  console.log(`Keys status: ${keysResponse.status}`)
  console.log(JSON.stringify(await keysResponse.json(), null, 2))

  console.log(`Reading policy inventory via ${baseUrl}/api/v1/policies`)
  const policiesResponse = await fetchWithTimeout(`${baseUrl}/api/v1/policies?organizationSlug=acme-governance`, {
    headers: {
      authorization: `Bearer ${serviceAccountKey}`,
    },
  }, 30000)

  console.log(`Policies status: ${policiesResponse.status}`)
  console.log(JSON.stringify(await policiesResponse.json(), null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

function assertNoForbiddenFields(value, blocked) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoForbiddenFields(entry, blocked))
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    if (blocked.includes(key)) {
      throw new Error(`Forbidden field found in payload: ${key}`)
    }
    assertNoForbiddenFields(entry, blocked)
  }
}

function assertProofContract(value, tier) {
  if (!value?.proof) {
    return
  }

  if (typeof value.proof.proofRef !== 'string' || !value.proof.proofRef) {
    throw new Error('Proof envelope is missing proofRef')
  }

  if (tier === 'pro' && 'decisionRef' in value.proof) {
    throw new Error('Pro proof envelope should not expose decisionRef')
  }
}
