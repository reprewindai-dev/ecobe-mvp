import assert from 'node:assert/strict'
import test from 'node:test'

import { CO2_ROUTER_TOOLS, getToolDefinition } from '@/lib/mcp/tool-catalog'
import { buildMcpTools } from '@/lib/x402/mcp'

test('defines one immutable non-mutating catalog with unique names and complete contracts', () => {
  const names = CO2_ROUTER_TOOLS.map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual(names, [
    'co2router_route',
    'co2router_explain',
    'co2router_proof',
    'co2router_replay',
  ])

  for (const tool of CO2_ROUTER_TOOLS) {
    assert.ok(tool.requiredScope)
    assert.match(tool.riskClass, /^(READ|SIMULATE)$/)
    assert.equal(tool.mutatesInfrastructure, false)
    assert.equal(tool.inputJsonSchema.type, 'object')
    assert.equal(typeof tool.engineRequest, 'function')
  }
  assert.equal(getToolDefinition('missing'), undefined)
})

test('x402 discovery derives overlapping tool descriptions and schemas from the shared catalog', () => {
  const discovered = buildMcpTools()
  for (const definition of CO2_ROUTER_TOOLS) {
    const tool = discovered.find((candidate) => candidate.name === definition.name)
    assert.ok(tool, `${definition.name} missing from discovery`)
    assert.equal(tool.description, definition.description)
    assert.deepEqual(tool.inputSchema, definition.inputJsonSchema)
  }
})
