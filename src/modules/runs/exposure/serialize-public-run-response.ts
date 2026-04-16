import type { PublicRunResponse } from '@/modules/runs/contracts/public-run.types'
import { mapInternalRunProofToPublicCandidate } from '@/modules/runs/mappers/map-internal-run-proof-to-public'
import type { ExposureContext } from '@/modules/runs/exposure/exposure-tier.types'
import { serializePublicRunProof } from '@/modules/runs/exposure/serialize-public-run-proof'
import { NEVER_PUBLIC_FIELDS, resolveAllowedPathsByTier } from '@/modules/runs/exposure/public-run-field-policy'
import { omitDeep } from '@/modules/runs/utils/omit-deep'
import { pickDeep } from '@/modules/runs/utils/pick-deep'
import { pruneUndefinedDeep } from '@/modules/runs/utils/prune-undefined-deep'

type UnknownRecord = Record<string, unknown>

export function serializePublicRunResponse(
  raw: PublicRunResponse & UnknownRecord,
  ctx: ExposureContext
): PublicRunResponse {
  const effectiveTier = ctx.tier === 'internal' && ctx.isInternalAdmin ? 'internal' : ctx.tier
  const proof = serializePublicRunProof(
    mapInternalRunProofToPublicCandidate(resolveProofInput(raw)),
    { tier: effectiveTier }
  )
  const composed = proof ? { ...raw, proof } : raw
  const stripped = effectiveTier === 'internal' ? composed : omitDeep(composed, NEVER_PUBLIC_FIELDS)
  const allowedPaths = resolveAllowedPathsByTier(effectiveTier)
  const projected = pickDeep(stripped as UnknownRecord, allowedPaths)
  const cleaned = pruneUndefinedDeep(projected) ?? {}
  return cleaned as PublicRunResponse
}

function resolveProofInput(raw: PublicRunResponse & UnknownRecord) {
  const internal = asRecord(raw.internal)
  const source = asRecord(internal?.source) ?? raw
  const governance = asRecord(raw.governance)
  const routing = asRecord(raw.routing)
  const audit = asRecord(raw.audit)

  return {
    runStatus: asString(source.status) ?? asString(raw.status),
    action: asString(source.action),
    createdAt: asDateLike(source.createdAt) ?? asDateLike(internal?.createdAt),
    policyApplied: resolvePolicyApplied(source, governance),
    auditRecordPresent: asBoolean(source.auditRecordPresent) ?? Boolean(audit?.auditId),
    customerReplayAvailable:
      asBoolean(source.customerReplayAvailable) ??
      asBoolean(source.replayAvailable) ??
      asBoolean(audit?.replayAvailable),
    requiresReview:
      asBoolean(source.requiresReview) ??
      (asString(source.status) === 'approval_required' ? true : undefined),
    systemUnavailable: asBoolean(source.systemUnavailable),
    publicProofRef: asString(source.publicProofRef) ?? asString(source.proofRef) ?? asString(audit?.proofRef),
    publicDecisionRef: asString(source.publicDecisionRef),
    proofHash: asString(source.proofHash),
    traceHash: asString(source.traceHash),
    previousTraceHash: asString(source.previousTraceHash),
    inputSignalHash: asString(source.inputSignalHash),
    governanceSource: asString(source.governanceSource),
    doctrineName: asString(source.doctrineName) ?? asString(source.doctrine),
    internalReasonCode: asString(source.reasonCode),
    operatingMode: asString(source.operatingMode),
    selectedRegion: asString(source.selectedRegion) ?? asString(routing?.region),
    totalMs: asNumber(source.totalMs),
    computeMs: asNumber(source.computeMs),
    cacheHit: asBoolean(source.cacheHit),
  }
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

function asDateLike(value: unknown): Date | string | undefined {
  if (value instanceof Date) {
    return value
  }

  return typeof value === 'string' ? value : undefined
}

function resolvePolicyApplied(
  source: UnknownRecord,
  governance: UnknownRecord | undefined
): boolean {
  const explicit = asBoolean(source.policyApplied)
  if (explicit !== undefined) {
    return explicit
  }

  return Boolean(source.policyVersionId) || Boolean(source.seked) || Boolean(governance)
}
