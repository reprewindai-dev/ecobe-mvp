import type { PublicRunEvent } from '@/modules/runs/contracts/public-run.types'
import { mapInternalReasonToPublic } from '@/modules/runs/mappers/map-internal-reason-to-public'

type UnknownRecord = Record<string, unknown>

export function mapInternalRunEventToPublicCandidate(event: {
  id: string
  runId: string
  eventType: string
  payload: unknown
  signature: string
  createdAt: Date
}): PublicRunEvent & UnknownRecord {
  const payload = asRecord(event.payload) ?? {}
  const seked = asRecord(payload.seked)
  const convergeos = asRecord(payload.convergeos)
  const ecobe = asRecord(payload.ecobe)
  const rawStatus = asString(payload.status)
  const reason = mapInternalReasonToPublic({
    internalReasonCode: asString(payload.reasonCode),
    internalReasonText: asString(payload.blockedReason) ?? asString(payload.error) ?? asString(payload.decisionReason),
    status: rawStatus,
  })

  return {
    id: event.id,
    runId: event.runId,
    type: event.eventType,
    createdAt: event.createdAt.toISOString(),
    status: normalizeStatus(rawStatus),
    decision: { reason },
    governance: {
      score: asNumber(seked?.score),
      drift: asBoolean(seked?.drift),
      fracture: asBoolean(seked?.fracture),
      tier: asString(seked?.tier),
      doctrineVersionId: asString(payload.doctrineVersionId),
    },
    reliability: {
      attemptCount: asNumber(convergeos?.attemptCount),
      schemaValid: asBoolean(convergeos?.schemaValid),
      qualityScore: asNumber(convergeos?.qualityScore),
      finalDecision: asString(convergeos?.finalDecision),
    },
    routing: {
      provider: asString(payload.provider) ?? asString(ecobe?.provider),
      region: asString(payload.region) ?? asString(ecobe?.region),
      estimatedLatencyMs: asNumber(payload.estimatedLatency) ?? asNumber(ecobe?.estimatedLatency),
      estimatedCostUsd: asNumber(payload.estimatedCost) ?? asNumber(ecobe?.estimatedCost),
      carbonEstimate: asNumber(payload.carbonEstimate) ?? asNumber(ecobe?.carbonEstimate),
      decisionReason: asString(payload.decisionReason) ?? asString(ecobe?.decisionReason),
      executionReference: asString(payload.executionReference) ?? asString(ecobe?.executionReference),
    },
    audit: {
      auditId: asString(payload.auditId) ?? event.runId,
      proofRef: asString(payload.proofRef),
      replayAvailable: asBoolean(payload.replayAvailable),
    },
    message: asString(payload.message) ?? asString(payload.error),
    internal: {
      payload,
      signature: event.signature,
    },
  }
}

function normalizeStatus(value?: string): PublicRunEvent['status'] {
  if (value === 'completed' || value === 'blocked' || value === 'approval_required' || value === 'failed') {
    return value
  }
  return undefined
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
