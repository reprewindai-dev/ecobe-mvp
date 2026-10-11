import { z } from 'zod'

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256 hex digest')

const decisionBindingSchema = z
  .object({
    decisionFrameId: z.string().min(1),
    proofHash: sha256HexSchema,
  })
  .strict()

function validityWindow(payload: { notBefore: string; expiresAt: string }, context: z.RefinementCtx) {
  if (Date.parse(payload.expiresAt) <= Date.parse(payload.notBefore)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expiresAt must be after notBefore',
      path: ['expiresAt'],
    })
  }
}

// Requester-signed execution intent: the first of two signatures. The
// Authority envelope commits to the hash of this exact signed intent, so who
// asked and who approved stay cryptographically separate.
export const ExecutionIntentPayloadSchema = z
  .object({
    intentId: z.string().min(1),
    customerOrTenant: z.string().min(1),
    audience: z.string().min(1),
    requester: z.string().min(1),
    operation: z.string().min(1),
    adapter: z.string().min(1),
    targetResource: z.string().min(1),
    payloadHash: sha256HexSchema,
    decision: decisionBindingSchema.optional(),
    // Compare-and-set expectations: the target state the requester observed.
    expectedPreStateRoot: sha256HexSchema.optional(),
    expectedGeneration: z.number().int().nonnegative().optional(),
    issuedAt: z.string().datetime(),
    notBefore: z.string().datetime(),
    expiresAt: z.string().datetime(),
    nonce: z.string().min(16),
    signerKeyId: z.string().min(1),
  })
  .strict()
  .superRefine(validityWindow)

export const SignedIntentSchema = z
  .object({
    payload: ExecutionIntentPayloadSchema,
    algorithm: z.literal('Ed25519'),
    signature: z.string().min(1),
  })
  .strict()

export type ExecutionIntentPayload = z.infer<typeof ExecutionIntentPayloadSchema>
export type SignedIntent = z.infer<typeof SignedIntentSchema>

export type VerifiedIntent = Readonly<
  ExecutionIntentPayload & {
    algorithm: 'Ed25519'
    intentCommitment: string
    verifiedAt: string
  }
>

// A requester key is bound to one principal so a key cannot sign as another.
export type RequesterKey = { principal: string; publicKeyPem: string }

// Authority envelope fields from the locked portable-authority spec, section 7.
export const AuthorityPayloadSchema = z
  .object({
    authorityId: z.string().min(1),
    licenseId: z.string().min(1),
    customerOrTenant: z.string().min(1),
    audience: z.string().min(1),
    actor: z.string().min(1),
    requester: z.string().min(1),
    scopes: z.array(z.string().min(1)).min(1),
    permittedAdapters: z.array(z.string().min(1)).min(1),
    targetResourceBounds: z.array(z.string().min(1)).min(1),
    // Each authority executes at most once (single-use nonce), so budgets bound
    // what that one execution may consume.
    budgetBounds: z
      .object({
        maxEnergyKwh: z.number().positive().optional(),
        maxCostUsd: z.number().positive().optional(),
      })
      .strict()
      .refine((bounds) => bounds.maxEnergyKwh !== undefined || bounds.maxCostUsd !== undefined, {
        message: 'at least one budget bound is required',
      }),
    approvalPolicyId: z.string().min(1),
    payloadHash: sha256HexSchema,
    policyHash: sha256HexSchema,
    // Second signature: commits to the hash of the exact signed intent.
    intentCommitment: sha256HexSchema,
    // Optional binding to the CO2 Router decision this authority executes.
    decision: decisionBindingSchema.optional(),
    // Writer generation for Class B1 (fencing) targets.
    fencingGeneration: z.number().int().nonnegative().optional(),
    issuedAt: z.string().datetime(),
    notBefore: z.string().datetime(),
    expiresAt: z.string().datetime(),
    nonce: z.string().min(16),
    issuerKeyId: z.string().min(1),
  })
  .strict()
  .superRefine((payload, context) => {
    for (const field of ['scopes', 'permittedAdapters', 'targetResourceBounds'] as const) {
      if (new Set(payload[field]).size !== payload[field].length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be unique`, path: [field] })
      }
    }
    validityWindow(payload, context)
  })

export const SignedAuthoritySchema = z
  .object({
    payload: AuthorityPayloadSchema,
    algorithm: z.literal('Ed25519'),
    signature: z.string().min(1),
  })
  .strict()

export type AuthorityPayload = z.infer<typeof AuthorityPayloadSchema>
export type SignedAuthority = z.infer<typeof SignedAuthoritySchema>

export type VerifiedAuthority = Readonly<
  AuthorityPayload & {
    algorithm: 'Ed25519'
    verifiedAt: string
  }
>
