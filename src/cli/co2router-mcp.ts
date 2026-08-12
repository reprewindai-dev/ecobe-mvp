#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createEngineTransport } from '../lib/engine/engine-client'
import { loadLocalEntitlement } from '../lib/license/license-loader'
import { createCo2RouterMcpServer } from '../lib/mcp/server-factory'

async function main() {
  const entitlement = await loadLocalEntitlement()
  const server = createCo2RouterMcpServer({
    entitlement,
    engine: createEngineTransport(),
  })
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'CO2 Router MCP startup failed')
  process.exitCode = 1
})
