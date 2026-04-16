import { z } from 'zod'

export const PUBLIC_RUN_PROOF_STATUSES = [
  'governed',
  'constrained',
  'review_required',
  'unavailable',
] as const

export const PUBLIC_RUN_PROOF_REASON_CATEGORIES = [
  'compliant',
  'constrained',
  'manual_review',
  'system_unavailable',
] as const

export const PublicRunProofStatusSchema = z.enum(PUBLIC_RUN_PROOF_STATUSES)

export const PublicRunProofReasonCategorySchema = z.enum(PUBLIC_RUN_PROOF_REASON_CATEGORIES)

export const PublicRunProofEnvelopeSchema = z.object({
  status: PublicRunProofStatusSchema,
  verified: z.boolean(),
  auditRecordPresent: z.boolean(),
  replayable: z.boolean().optional(),
  policyApplied: z.boolean(),
  proofRef: z.string().min(1),
  decisionRef: z.string().min(1).optional(),
  evaluatedAt: z.string().datetime(),
  reasonCategory: PublicRunProofReasonCategorySchema.optional(),
})

export type PublicRunProofStatus = z.infer<typeof PublicRunProofStatusSchema>
export type PublicRunProofReasonCategory = z.infer<typeof PublicRunProofReasonCategorySchema>
export type PublicRunProofEnvelope = z.infer<typeof PublicRunProofEnvelopeSchema>
