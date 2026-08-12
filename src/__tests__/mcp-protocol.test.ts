import assert from 'node:assert/strict'
import test from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'
import { createCo2RouterMcpServer } from '@/lib/mcp/server-factory'
import type { EngineTransport } from '@/lib/mcp/tool-executor'

const entitlement: VerifiedEntitlement = {
  licenseId: 'license-protocol-test',
  product: 'co2-router',
  edition: 'router',
  customerOrTenant: 'customer-test',
  audience: 'installation-test',
  scopes: ['route:simulate', 'proof:read', 'replay:read'],
  issuedAt: '2026-08-12T00:00:00.000Z',
  notBefore: '2026-08-12T00:00:00.000Z',
  expiresAt: null,
  majorVersionMin: 1,
  majorVersionMax: 1,
  issuerKeyId: 'key-test',
  algorithm: 'Ed25519',
  verifiedAt: '2026-08-12T00:00:01.000Z',
}

test('negotiates MCP, lists the shared catalog, and calls the real executor', async () => {
  const calls: string[] = []
  const engine: EngineTransport = {
    async request(input) {
      calls.push(input.path)
      return { status: 200, body: { decision: 'DELAY', proofHash: 'sha256:test' } }
    },
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createCo2RouterMcpServer({ entitlement, engine })
  const client = new Client({ name: 'co2router-test-client', version: '1.0.0' })

  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const listed = await client.listTools()
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ['co2router_route', 'co2router_explain', 'co2router_proof', 'co2router_replay'],
    )
    const called = await client.callTool({
      name: 'co2router_route',
      arguments: { allowedRegions: ['ca-qc'], estimatedEnergyKwh: 2.5 },
    })
    assert.equal(called.isError, false)
    assert.deepEqual(called.structuredContent, { decision: 'DELAY', proofHash: 'sha256:test' })
    assert.deepEqual(calls, ['ci/route'])
  } finally {
    await client.close()
    await server.close()
  }
})
