import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import { CO2_ROUTER_TOOLS } from './tool-catalog'
import { executeMcpTool, type EngineTransport } from './tool-executor'

export type Co2RouterMcpServerDependencies = {
  entitlement: VerifiedEntitlement
  engine: EngineTransport
}

export function createCo2RouterMcpServer(dependencies: Co2RouterMcpServerDependencies) {
  const server = new McpServer(
    { name: 'co2-router', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  for (const definition of CO2_ROUTER_TOOLS) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.input,
        annotations: {
          readOnlyHint: definition.riskClass === 'READ',
          destructiveHint: false,
          idempotentHint: definition.riskClass === 'READ',
          openWorldHint: false,
        },
      },
      async (arguments_: unknown) =>
        executeMcpTool({
          name: definition.name,
          arguments: arguments_,
          entitlement: dependencies.entitlement,
          engine: dependencies.engine,
        }),
    )
  }

  return server
}
