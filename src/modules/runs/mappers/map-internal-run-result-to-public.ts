import type { Run } from '@prisma/client'

import type { PublicRunResponse } from '@/modules/runs/contracts/public-run.types'
import type { PublicRunStatus } from '@/modules/runs/contracts/public-run-status'
import { mapInternalReasonToPublic } from '@/modules/runs/mappers/map-internal-reason-to-public'

type UnknownRecord = Record<string, unknown>

export function mapInternalRunResultToPublicCandidate(internal: unknown): PublicRunResponse & UnknownRecord {
  const source = resolveEnvelope(internal)
  const seked = asRecord(source.seked)
  const convergeos = asRecord(source.convergeos)
  const ecobe = asRecord(source.ecobe)
  const status = normalizeStatus(source.status)
  const reason = mapInternalReasonToPublic({
    internalReasonCode: asString(source.reasonCode),
    internalReasonText: asString(source.blockedReason) ?? asString(source.error) ?? asString(ecobe?.decisionReason),
    status,
  })

  const output = asRecord(source.result) ?? asRecord(source.resultPayload) ?? asRecord(source.output)

  const candidate: PublicRunResponse & UnknownRecord = {
    runId: asString(source.runId) ?? asString(source.id) ?? 'unknown_run',
    status,
    decision: {
      reason,
    },
    result: status === 'completed' ? { output: output ?? null } : null,
    governance: {
      score: asNumber(seked?.score),
      drift: asBoolean(seked?.drift),
      fracture: asBoolean(seked?.fracture),
      tier: asString(seked?.tier),
      doctrineVersionId: asString(source.doctrineVersionId),
    },
    reliability: {
      attemptCount: asNumber(convergeos?.attemptCount),
      schemaValid: asBoolean(convergeos?.schemaValid),
      qualityScore: asNumber(convergeos?.qualityScore),
      finalDecision: asString(convergeos?.finalDecision),
    },
    routing: ecobe
      ? {
          provider: asString(ecobe.provider),
          region: asString(ecobe.region),
          estimatedLatencyMs: asNumber(ecobe.estimatedLatency),
          estimatedCostUsd: asNumber(ecobe.estimatedCost),
          carbonEstimate: asNumber(ecobe.carbonEstimate),
          waterRiskLevel: asString(ecobe.waterRiskLevel),
          energyProfile: asString(ecobe.energyProfile),
          decisionReason: asString(ecobe.decisionReason),
          executionReference: asString(ecobe.executionReference),
        }
      : null,
    audit: {
      auditId: asString(source.auditId) ?? asString(source.id) ?? 'unknown_audit',
      proofRef: asString(source.proofRef),
      replayAvailable: asBoolean(source.replayAvailable),
    },
    internal: {
      source,
      correlationId: asString(source.correlationId),
      inputPayload: source.inputPayload,
      resultEnvelope: source.resultEnvelope,
      status: source.status,
    },
  }

  return candidate
}

function resolveEnvelope(internal: unknown): UnknownRecord {
  const record = asRecord(internal) ?? {}
  const resultEnvelope = asRecord(record.resultEnvelope)
  if (resultEnvelope) {
    return {
      ...record,
      ...resultEnvelope,
    }
  }
  return record
}

function normalizeStatus(raw: unknown): PublicRunStatus {
  const status = asString(raw)
  if (status === 'completed' || status === 'blocked' || status === 'approval_required' || status === 'failed') {
    return status
  }
  if (status === 'pending') {
    return 'approval_required'
  }
  return 'failed'
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

export function mapRunRecordToInternalEnvelope(run: Run): UnknownRecord {
  return {
    ...run,
    runId: run.id,
    status: run.status,
    result: run.resultPayload,
    resultEnvelope: run.resultEnvelope,
    blockedReason: run.blockedReason,
    auditId: run.auditId ?? run.id,
  }
}
