import type {
  PublicRunProofEnvelope,
  PublicRunProofReasonCategory,
  PublicRunProofStatus,
} from '@/modules/runs/contracts/public-run-proof.schema'

export type InternalRunProofInput = {
  runStatus?: string | null
  action?: string | null
  createdAt?: Date | string | null
  policyApplied?: boolean | null
  auditRecordPresent?: boolean | null
  customerReplayAvailable?: boolean | null
  requiresReview?: boolean | null
  systemUnavailable?: boolean | null
  publicProofRef?: string | null
  publicDecisionRef?: string | null
  proofHash?: string | null
  traceHash?: string | null
  previousTraceHash?: string | null
  inputSignalHash?: string | null
  governanceSource?: string | null
  doctrineName?: string | null
  internalReasonCode?: string | null
  operatingMode?: string | null
  selectedRegion?: string | null
  totalMs?: number | null
  computeMs?: number | null
  cacheHit?: boolean | null
}

export type PublicRunProofCandidate = Partial<PublicRunProofEnvelope> & {
  _internal?: {
    internalReasonCode?: string | null
  }
}

function mapStatus(input: InternalRunProofInput): PublicRunProofStatus {
  if (input.systemUnavailable) return 'unavailable'
  if (input.requiresReview) return 'review_required'
  if (input.action === 'deny' || input.action === 'delay' || input.action === 'throttle') {
    return 'constrained'
  }
  return 'governed'
}

function mapReasonCategory(input: InternalRunProofInput): PublicRunProofReasonCategory | undefined {
  if (input.systemUnavailable) return 'system_unavailable'
  if (input.requiresReview) return 'manual_review'
  if (input.action === 'deny' || input.action === 'delay' || input.action === 'throttle') {
    return 'constrained'
  }
  if (input.policyApplied) return 'compliant'
  return undefined
}

export function mapInternalRunProofToPublicCandidate(
  input: InternalRunProofInput | undefined
): PublicRunProofCandidate | undefined {
  if (!input) {
    return undefined
  }

  const evaluatedAt = normalizeEvaluatedAt(input.createdAt)

  return {
    status: mapStatus(input),
    verified: Boolean(input.publicProofRef),
    auditRecordPresent: Boolean(input.auditRecordPresent),
    replayable: input.customerReplayAvailable ?? undefined,
    policyApplied: Boolean(input.policyApplied),
    proofRef: input.publicProofRef ?? '',
    decisionRef: input.publicDecisionRef ?? undefined,
    evaluatedAt,
    reasonCategory: mapReasonCategory(input),
    _internal: {
      internalReasonCode: input.internalReasonCode ?? null,
    },
  }
}

function normalizeEvaluatedAt(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return new Date().toISOString()
}
