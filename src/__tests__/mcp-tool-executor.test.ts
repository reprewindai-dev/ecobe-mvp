import assert from 'node:assert/strict'
import test from 'node:test'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'
import { createEngineTransport, validateEngineBaseUrl } from '@/lib/engine/engine-client'
import {
  executeMcpTool,
  type EngineTransport,
} from '@/lib/mcp/tool-executor'

function entitlement(scopes: readonly string[]): VerifiedEntitlement {
  return {
    licenseId: 'license-test',
    product: 'co2-router',
    edition: 'router',
    customerOrTenant: 'customer-test',
    audience: 'installation-test',
    scopes,
    issuedAt: '2026-08-12T00:00:00.000Z',
    notBefore: '2026-08-12T00:00:00.000Z',
    expiresAt: null,
    majorVersionMin: 1,
    majorVersionMax: 1,
    issuerKeyId: 'key-test',
    algorithm: 'Ed25519',
    verifiedAt: '2026-08-12T00:00:01.000Z',
  }
}

function recordingEngine(status = 200, body: unknown = { decision: 'REROUTE', proof: 'proof-1' }) {
  const calls: Parameters<EngineTransport['request']>[0][] = []
  const engine: EngineTransport = {
    async request(input) {
      assert.doesNotMatch(input.path, /co2router\.com/i)
      calls.push(input)
      return { status, body }
    },
  }
  return { engine, calls }
}

test('rejects unknown tools, missing scopes, and malformed input before engine I/O', async () => {
  const { engine, calls } = recordingEngine()
  const unknown = await executeMcpTool({
    name: 'unknown',
    arguments: {},
    entitlement: entitlement(['route:simulate']),
    engine,
  })
  const denied = await executeMcpTool({
    name: 'co2router_route',
    arguments: { allowedRegions: ['ca-qc'], estimatedEnergyKwh: 1 },
    entitlement: entitlement(['proof:read']),
    engine,
  })
  const malformed = await executeMcpTool({
    name: 'co2router_route',
    arguments: { allowedRegions: [], estimatedEnergyKwh: -1 },
    entitlement: entitlement(['route:simulate']),
    engine,
  })

  assert.equal(unknown.isError, true)
  assert.equal(denied.isError, true)
  assert.equal(malformed.isError, true)
  assert.equal(calls.length, 0)
})

test('calls the mapped private-engine path once and returns its actual result', async () => {
  const { engine, calls } = recordingEngine()
  const result = await executeMcpTool({
    name: 'co2router_route',
    arguments: { allowedRegions: ['ca-qc'], estimatedEnergyKwh: 4.2 },
    entitlement: entitlement(['route:simulate']),
    engine,
  })

  assert.equal(result.isError, false)
  assert.deepEqual(result.structuredContent, { decision: 'REROUTE', proof: 'proof-1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, 'ci/route')
  assert.equal(calls[0].method, 'POST')
})

test('reports engine failures without claiming success', async () => {
  const { engine } = recordingEngine(503, { error: 'engine unavailable' })
  const result = await executeMcpTool({
    name: 'co2router_route',
    arguments: { allowedRegions: ['ca-qc'], estimatedEnergyKwh: 4.2 },
    entitlement: entitlement(['route:simulate']),
    engine,
  })

  assert.equal(result.isError, true)
  assert.deepEqual(result.structuredContent, { error: 'engine unavailable' })
})

test('production engine transport rejects insecure public HTTP and targets only its configured engine', async () => {
  assert.throws(() => validateEngineBaseUrl('http://engine.example.com', 'production'))
  assert.doesNotThrow(() => validateEngineBaseUrl('http://127.0.0.1:8080', 'production'))

  let requestedUrl = ''
  const engine = createEngineTransport({
    baseUrl: 'http://127.0.0.1:8080',
    internalKey: 'internal-test-key',
    environment: 'production',
    fetchImplementation: async (input) => {
      requestedUrl = input.toString()
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  await engine.request({ method: 'GET', path: 'ci/decisions/frame/replay', requestId: 'request-1' })
  assert.equal(requestedUrl, 'http://127.0.0.1:8080/api/v1/ci/decisions/frame/replay')
  assert.doesNotMatch(requestedUrl, /co2router\.com/i)
})
