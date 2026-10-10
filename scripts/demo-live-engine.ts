// End-to-end demo: an MCP client drives the built stdio CO2 Router server, which
// calls a real running ecobe-engineclaude. Nothing here is mocked; the engine's
// own provenance labels (live vs fallback signals) are printed as returned.
//
// Required environment:
//   ECOBE_ENGINE_URL               e.g. http://127.0.0.1:8080
//   ECOBE_ENGINE_INTERNAL_KEY      the engine's ECOBE_INTERNAL_API_KEY
//   DECISION_API_SIGNATURE_SECRET  the engine's DECISION_API_SIGNATURE_SECRET
//   CO2ROUTER_LICENSE_FILE         signed license (see generate-development-license.ts)
//   CO2ROUTER_TRUST_STORE_FILE     issuer trust store
//   CO2ROUTER_INSTALLATION_ID      license audience
// Optional:
//   DEMO_REGIONS                   comma-separated, default us-east-1,us-west-2,eu-west-1
//   DEMO_ENERGY_KWH                default 12

import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const REQUIRED = [
  'ECOBE_ENGINE_URL',
  'ECOBE_ENGINE_INTERNAL_KEY',
  'DECISION_API_SIGNATURE_SECRET',
  'CO2ROUTER_LICENSE_FILE',
  'CO2ROUTER_TRUST_STORE_FILE',
  'CO2ROUTER_INSTALLATION_ID',
] as const

type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: unknown }

function pick(source: unknown, dottedPath: string): unknown {
  return dottedPath
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
      source,
    )
}

function printFields(title: string, source: unknown, fields: string[]) {
  console.log(`\n${title}`)
  for (const field of fields) {
    const value = pick(source, field)
    if (value !== undefined) console.log(`  ${field.padEnd(32)} ${JSON.stringify(value)}`)
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  if (result.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`)
  }
  return result.structuredContent
}

async function main() {
  const missing = REQUIRED.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`Missing required environment: ${missing.join(', ')}`)
    process.exit(2)
  }

  const regions = (process.env.DEMO_REGIONS ?? 'us-east-1,us-west-2,eu-west-1')
    .split(',')
    .map((region) => region.trim())
    .filter(Boolean)
  const energyKwh = Number(process.env.DEMO_ENERGY_KWH ?? '12')

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/co2router-mcp.mjs')],
    env: {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      CO2ROUTER_PRODUCT_MAJOR_VERSION: process.env.CO2ROUTER_PRODUCT_MAJOR_VERSION ?? '1',
    },
    stderr: 'pipe',
  })
  let serverStderr = ''
  transport.stderr?.on('data', (chunk) => {
    serverStderr += chunk.toString()
  })

  const client = new Client({ name: 'co2router-live-demo', version: '1.0.0' })
  try {
    await client.connect(transport)
  } catch (error) {
    throw new Error(`MCP server failed to start: ${serverStderr.trim()}`, { cause: error })
  }

  try {
    const { tools } = await client.listTools()
    console.log(`MCP tools: ${tools.map((tool) => tool.name).join(', ')}`)

    const started = Date.now()
    const decision = await callTool(client, 'co2router_route', {
      workloadId: 'live-demo-workload',
      allowedRegions: regions,
      estimatedEnergyKwh: energyKwh,
    })
    console.log(`\nco2router_route: ${regions.join(', ')} @ ${energyKwh} kWh (${Date.now() - started} ms round trip)`)
    printFields('Decision', decision, [
      'decision',
      'reasonCode',
      'selectedRegion',
      'recommendation',
      'decisionFrameId',
      'proofEnvelope.proofHash',
    ])
    printFields('Signal provenance (as labeled by the engine)', decision, [
      'signalMode',
      'signalConfidence',
      'fallbackUsed',
      'mss.carbonProvider',
      'mss.carbonProviderHealth',
      'mss.waterAuthorityHealth',
      'mss.waterFreshnessSec',
    ])

    const frameId = pick(decision, 'decisionFrameId')
    if (typeof frameId !== 'string' || frameId.startsWith('fallback-')) {
      console.log('\nNo persisted decision frame was returned; skipping explain/proof.')
      return
    }

    const trace = await callTool(client, 'co2router_explain', { frameId })
    printFields('co2router_explain (recorded trace)', trace, [
      'traceHash',
      'inputSignalHash',
      'action',
      'reasonCode',
      'selectedRegion',
      'totalMs',
    ])

    const proof = await callTool(client, 'co2router_proof', { frameId })
    printFields('co2router_proof (replay)', proof, [
      'decisionFrameId',
      'storedResponse.decision',
      'storedResponse.proofEnvelope.proofHash',
    ])
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
