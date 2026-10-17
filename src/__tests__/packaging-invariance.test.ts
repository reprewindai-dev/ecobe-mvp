import assert from 'node:assert/strict'
import test from 'node:test'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'
import { buildMcpTools } from '@/lib/x402/mcp'
import { CO2_ROUTER_TOOLS } from '@/lib/mcp/tool-catalog'
import { executeMcpTool, type EngineTransport } from '@/lib/mcp/tool-executor'

/**
 * Packaging invariance, request level.
 *
 * The same governed decision must reach the engine identically whichever surface carried
 * it. The MCP surface names regions `allowedRegions`; the engine (and the x402 proxy, which
 * forwards bodies unchanged) uses its native `preferredRegions`. These tests pin that the
 * MCP mapping is faithful and loses nothing.
 *
 * Scope: this proves the REQUEST reaching the engine is identical across surfaces. It does not
 * prove identical proofHash end to end; that needs a running engine and is a separate check.
 */

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

function recorder() {
  const calls: Parameters<EngineTransport['request']>[0][] = []
  const engine: EngineTransport = {
    async request(input) {
      calls.push(input)
      return { status: 200, body: { ok: true } }
    },
  }
  return { calls, engine }
}

const routeTool = CO2_ROUTER_TOOLS.find((t) => t.name === 'co2router_route')!
const allScopes = CO2_ROUTER_TOOLS.map((t) => t.requiredScope)

test('MCP route call reaches the engine as the native /ci/route body (no field lost)', async () => {
  const { calls, engine } = recorder()
  await executeMcpTool({
    name: 'co2router_route',
    arguments: {
      workloadId: 'job-42',
      allowedRegions: ['eu-west-1', 'us-east-1'],
      estimatedEnergyKwh: 3.5,
      maxLatencyMs: 250,
      policy: { profile: 'default' },
    },
    entitlement: entitlement(allScopes),
    engine,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, 'ci/route')
  assert.deepEqual(calls[0].body, {
    preferredRegions: ['eu-west-1', 'us-east-1'],
    estimatedEnergyKwh: 3.5,
    workload: { name: 'job-42' },
    metadata: { maxLatencyMs: 250, policy: { profile: 'default' } },
  })
})

test('the same input through the MCP surface twice yields an identical engine request (deterministic mapping)', async () => {
  const args = { allowedRegions: ['us-west-2'], estimatedEnergyKwh: 1 }
  const a = recorder()
  const b = recorder()
  await executeMcpTool({ name: 'co2router_route', arguments: args, entitlement: entitlement(allScopes), engine: a.engine })
  await executeMcpTool({ name: 'co2router_route', arguments: args, entitlement: entitlement(allScopes), engine: b.engine })
  assert.deepEqual(a.calls[0].body, b.calls[0].body)
  assert.equal(a.calls[0].path, b.calls[0].path)
})

test('unknown fields are refused before the engine, never silently dropped', async () => {
  const { calls, engine } = recorder()
  const res = await executeMcpTool({
    name: 'co2router_route',
    arguments: { allowedRegions: ['eu-west-1'], estimatedEnergyKwh: 1, surprise: true },
    entitlement: entitlement(allScopes),
    engine,
  })
  assert.equal(res.isError, true)
  assert.equal(calls.length, 0)
})

test('the x402 manifest advertises exactly the catalog the MCP server executes', () => {
  const x402 = buildMcpTools()
  assert.deepEqual(
    x402.map((t) => t.name).sort(),
    CO2_ROUTER_TOOLS.map((t) => t.name).sort(),
  )
  for (const tool of x402) {
    const def = CO2_ROUTER_TOOLS.find((t) => t.name === tool.name)!
    assert.deepEqual(tool.inputSchema, def.inputJsonSchema, `${tool.name} schema drifted between surfaces`)
    assert.equal(tool.annotations.readOnlyHint, def.riskClass === 'READ')
  }
  assert.equal(routeTool.mutatesInfrastructure, false)
})
