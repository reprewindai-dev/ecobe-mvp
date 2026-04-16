import type { ExposureClass, ExposureTier } from '@/modules/runs/exposure/exposure-tier.types'
import { RUN_FIELD_CLASSIFICATION } from '@/modules/runs/exposure/run-field-classification'

export const NEVER_PUBLIC_FIELDS = [
  'proofHash',
  'traceHash',
  'previousTraceHash',
  'inputSignalHash',
  'governanceSource',
  'doctrine',
  'reasonCode',
  'operatingMode',
  'selectedRegion',
  'cacheHit',
  'computeMs',
  'totalMs',
  'adapter',
  'transport',
  'trace',
  'rawProof',
] as const

export const NEVER_PUBLIC_PROOF_FIELDS = [
  'proofHash',
  'traceHash',
  'previousTraceHash',
  'inputSignalHash',
  'governanceSource',
  'doctrineName',
  'internalReasonCode',
  'selectedRegion',
  'operatingMode',
  'totalMs',
  'computeMs',
  'cacheHit',
  'rawTrace',
  'rawProofChain',
] as const

const VISIBLE_CLASSES_BY_TIER: Record<ExposureTier, ExposureClass[]> = {
  free: ['public_free'],
  pro: ['public_free', 'customer_pro'],
  elite: ['public_free', 'customer_pro', 'customer_elite'],
  internal: ['public_free', 'customer_pro', 'customer_elite', 'internal_only'],
}

export function resolveAllowedPathsByTier(tier: ExposureTier): string[] {
  const visible = new Set(VISIBLE_CLASSES_BY_TIER[tier])
  return Object.entries(RUN_FIELD_CLASSIFICATION)
    .filter(([, klass]) => visible.has(klass))
    .map(([path]) => path)
}
