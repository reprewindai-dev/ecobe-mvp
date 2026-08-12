import { randomUUID } from 'node:crypto'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import { getToolDefinition } from './tool-catalog'

export type EngineTransport = {
  request(input: {
    method: 'GET' | 'POST'
    path: string
    body?: unknown
    requestId: string
  }): Promise<{ status: number; body: unknown }>
}

export type ExecuteMcpToolInput = {
  name: string
  arguments: unknown
  entitlement: VerifiedEntitlement
  engine: EngineTransport
}

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
  isError: boolean
}

function result(body: unknown, isError: boolean): McpToolResult {
  const structuredContent =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { result: body }
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent,
    isError,
  }
}

export async function executeMcpTool(input: ExecuteMcpToolInput): Promise<McpToolResult> {
  const definition = getToolDefinition(input.name)
  if (!definition) return result({ error: 'Unknown CO2 Router tool' }, true)
  if (!input.entitlement.scopes.includes(definition.requiredScope)) {
    return result({ error: 'Entitlement scope denied', requiredScope: definition.requiredScope }, true)
  }

  const parsed = definition.input.safeParse(input.arguments)
  if (!parsed.success) {
    return result(
      { error: 'Invalid tool arguments', issues: parsed.error.issues },
      true,
    )
  }

  const request = definition.engineRequest(parsed.data)
  try {
    const response = await input.engine.request({ ...request, requestId: randomUUID() })
    return result(response.body, response.status < 200 || response.status >= 300)
  } catch (error) {
    return result(
      { error: error instanceof Error ? error.message : 'Private engine request failed' },
      true,
    )
  }
}
