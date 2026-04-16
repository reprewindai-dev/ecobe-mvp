import type { PublicRunStatus } from './public-run-status'
import type { PublicRunProofEnvelope } from './public-run-proof.schema'

export type PublicRunRequest = {
  environment: string
  workload: {
    type: 'inference' | 'batch' | 'classification' | 'other'
    operation: string
    input: Record<string, unknown>
    schema?: Record<string, unknown>
    model?: string
    temperature?: number
    estimatedUsage?: {
      tokenCount?: number
      requestCount?: number
    }
  }
  constraints?: {
    latencyMs?: number
    costUsd?: number
    carbon?: {
      maxCarbonGPerKwh?: number
    }
    water?: {
      mode?: 'ignore' | 'prefer_low' | 'enforce'
    }
    energy?: {
      preference?: 'default' | 'renewable_preferred' | 'low_intensity'
    }
  }
  targets?: {
    providers?: string[]
    preferredRegions?: string[]
  }
  metadata?: {
    requestId?: string
    customerRef?: string
    traceId?: string
    projectId?: string
    projectSlug?: string
  }
}

export type PublicRunResponse = {
  runId: string
  status: PublicRunStatus
  decision: {
    reason: string
  }
  result?: {
    output?: Record<string, unknown> | null
  } | null
  governance?: {
    score?: number
    drift?: boolean
    fracture?: boolean
    tier?: string
    doctrineVersionId?: string
  }
  reliability?: {
    attemptCount?: number
    schemaValid?: boolean
    qualityScore?: number
    finalDecision?: string
  }
  routing?: {
    provider?: string
    region?: string
    estimatedLatencyMs?: number
    estimatedCostUsd?: number
    carbonEstimate?: number
    waterRiskLevel?: string
    energyProfile?: string
    decisionReason?: string
    executionReference?: string
  } | null
  audit: {
    auditId: string
    proofRef?: string
    replayAvailable?: boolean
  }
  proof?: PublicRunProofEnvelope
  internal?: Record<string, unknown>
}

export type PublicRunEvent = {
  id: string
  runId: string
  type: string
  createdAt: string
  status?: PublicRunStatus
  decision?: {
    reason?: string
  }
  governance?: PublicRunResponse['governance']
  reliability?: PublicRunResponse['reliability']
  routing?: PublicRunResponse['routing']
  audit?: PublicRunResponse['audit']
  message?: string
  internal?: Record<string, unknown>
}

export type LegacyRunRequest = {
  environmentSlug?: string
  projectId?: string
  input: Record<string, unknown>
  providerConstraints?: {
    preferredRegions?: string[]
    providers?: string[]
  }
  latencyCeiling?: number
  costCeiling?: number
  carbonPolicy?: {
    maxCarbonGPerKwh?: number
  }
  model?: string
  tokenCount?: number
  requestCount?: number
  operation?: string
  schema?: Record<string, unknown>
  temperature?: number
  output?: Record<string, unknown>
}
