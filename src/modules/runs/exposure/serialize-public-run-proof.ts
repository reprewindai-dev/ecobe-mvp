import {
  PublicRunProofEnvelopeSchema,
  type PublicRunProofEnvelope,
} from '@/modules/runs/contracts/public-run-proof.schema'
import type { PublicRunProofCandidate } from '@/modules/runs/mappers/map-internal-run-proof-to-public'
import type { ExposureTier } from '@/modules/runs/exposure/exposure-tier.types'

type SerializePublicRunProofOptions = {
  tier: ExposureTier
}

function applyTier(
  candidate: PublicRunProofCandidate,
  tier: ExposureTier
): Partial<PublicRunProofEnvelope> {
  const freeShape: Partial<PublicRunProofEnvelope> = {
    status: candidate.status,
    verified: candidate.verified,
    auditRecordPresent: candidate.auditRecordPresent,
    policyApplied: candidate.policyApplied,
    proofRef: candidate.proofRef,
    evaluatedAt: candidate.evaluatedAt,
  }

  if (tier === 'free') return freeShape

  const proShape: Partial<PublicRunProofEnvelope> = {
    ...freeShape,
    replayable: candidate.replayable,
    reasonCategory: candidate.reasonCategory,
  }

  if (tier === 'pro') return proShape

  return {
    ...proShape,
    decisionRef: candidate.decisionRef,
  }
}

export function serializePublicRunProof(
  candidate: PublicRunProofCandidate | undefined,
  options: SerializePublicRunProofOptions
): PublicRunProofEnvelope | undefined {
  if (!candidate || !candidate.proofRef) {
    return undefined
  }

  const tiered = applyTier(candidate, options.tier)
  const sanitized = {
    status: tiered.status,
    verified: Boolean(tiered.verified),
    auditRecordPresent: Boolean(tiered.auditRecordPresent),
    replayable: tiered.replayable,
    policyApplied: Boolean(tiered.policyApplied),
    proofRef: tiered.proofRef,
    decisionRef: tiered.decisionRef,
    evaluatedAt: tiered.evaluatedAt,
    reasonCategory: tiered.reasonCategory,
  }

  return PublicRunProofEnvelopeSchema.parse(sanitized)
}
