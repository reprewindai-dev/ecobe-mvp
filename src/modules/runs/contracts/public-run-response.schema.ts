import { z } from 'zod'

import { PublicRunProofEnvelopeSchema } from './public-run-proof.schema'
import { PUBLIC_RUN_STATUSES } from './public-run-status'

export const PublicRunResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(PUBLIC_RUN_STATUSES),
  decision: z.object({
    reason: z.string(),
  }),
  result: z.object({
    output: z.record(z.unknown()).nullable().optional(),
  }).nullable().optional(),
  governance: z.object({
    score: z.number().optional(),
    drift: z.boolean().optional(),
    fracture: z.boolean().optional(),
    tier: z.string().optional(),
    doctrineVersionId: z.string().optional(),
  }).optional(),
  reliability: z.object({
    attemptCount: z.number().int().optional(),
    schemaValid: z.boolean().optional(),
    qualityScore: z.number().optional(),
    finalDecision: z.string().optional(),
  }).optional(),
  routing: z.object({
    provider: z.string().optional(),
    region: z.string().optional(),
    estimatedLatencyMs: z.number().int().optional(),
    estimatedCostUsd: z.number().optional(),
    carbonEstimate: z.number().optional(),
    waterRiskLevel: z.string().optional(),
    energyProfile: z.string().optional(),
    decisionReason: z.string().optional(),
    executionReference: z.string().optional(),
  }).nullable().optional(),
  audit: z.object({
    auditId: z.string(),
    proofRef: z.string().optional(),
    replayAvailable: z.boolean().optional(),
  }),
  proof: PublicRunProofEnvelopeSchema.optional(),
  internal: z.record(z.unknown()).optional(),
})

export const PublicRunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.string(),
  createdAt: z.string(),
  status: z.enum(PUBLIC_RUN_STATUSES).optional(),
  decision: z.object({
    reason: z.string().optional(),
  }).optional(),
  governance: z.object({
    score: z.number().optional(),
    drift: z.boolean().optional(),
    fracture: z.boolean().optional(),
    tier: z.string().optional(),
    doctrineVersionId: z.string().optional(),
  }).optional(),
  reliability: z.object({
    attemptCount: z.number().int().optional(),
    schemaValid: z.boolean().optional(),
    qualityScore: z.number().optional(),
    finalDecision: z.string().optional(),
  }).optional(),
  routing: z.object({
    provider: z.string().optional(),
    region: z.string().optional(),
    estimatedLatencyMs: z.number().int().optional(),
    estimatedCostUsd: z.number().optional(),
    carbonEstimate: z.number().optional(),
    waterRiskLevel: z.string().optional(),
    energyProfile: z.string().optional(),
    decisionReason: z.string().optional(),
    executionReference: z.string().optional(),
  }).nullable().optional(),
  audit: z.object({
    auditId: z.string(),
    proofRef: z.string().optional(),
    replayAvailable: z.boolean().optional(),
  }).optional(),
  message: z.string().optional(),
  internal: z.record(z.unknown()).optional(),
})
