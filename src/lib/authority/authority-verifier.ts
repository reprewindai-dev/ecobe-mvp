import { createPublicKey, verify } from 'node:crypto'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import {
  type AuthorityPayload,
  type ExecutionIntentPayload,
  type RequesterKey,
  SignedAuthoritySchema,
  type SignedIntent,
  SignedIntentSchema,
  type VerifiedAuthority,
  type VerifiedIntent,
} from './authority-schema'
import { canonicalHash, canonicalJsonBytes } from './canonical'

export const EXECUTE_SCOPE = 'authority:execute'
const DEFAULT_MAX_LIFETIME_MS = 15 * 60_000
const DEFAULT_CLOCK_TOLERANCE_MS = 30_000

export type AuthorityErrorCode =
  | 'INVALID_AUTHORITY'
  | 'UNKNOWN_ISSUER_KEY'
  | 'INVALID_SIGNATURE'
  | 'EDITION_NOT_AUTHORITY'
  | 'LICENSE_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'SCOPE_MISSING'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'LIFETIME_TOO_LONG'
  | 'ADAPTER_NOT_PERMITTED'
  | 'TARGET_OUT_OF_BOUNDS'
  | 'PAYLOAD_MISMATCH'
  | 'POLICY_MISMATCH'
  | 'DECISION_MISMATCH'
  | 'BUDGET_ESTIMATE_REQUIRED'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_INTENT'
  | 'UNKNOWN_REQUESTER_KEY'
  | 'REQUESTER_KEY_MISMATCH'
  | 'INVALID_INTENT_SIGNATURE'
  | 'INTENT_NOT_YET_VALID'
  | 'INTENT_EXPIRED'
  | 'INTENT_LIFETIME_TOO_LONG'
  | 'INTENT_MISMATCH'
  | 'INTENT_COMMITMENT_MISMATCH'

export class AuthorityVerificationError extends Error {
  constructor(
    public readonly code: AuthorityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AuthorityVerificationError'
  }
}

export type AuthorityRequest = {
  adapter: string
  targetResource: string
  payload: unknown
  policyHash: string
  decision?: { decisionFrameId: string; proofHash: string }
  estimatedEnergyKwh?: number
  estimatedCostUsd?: number
}

export type VerifyAuthorityInput = {
  signedAuthority: unknown
  trustedPublicKeys: ReadonlyMap<string, string>
  entitlement: VerifiedEntitlement
  request: AuthorityRequest
  intent: VerifiedIntent
  now?: Date
  maxLifetimeMs?: number
  clockToleranceMs?: number
}

export type VerifyIntentInput = {
  signedIntent: unknown
  trustedRequesterKeys: ReadonlyMap<string, RequesterKey>
  entitlement: VerifiedEntitlement
  request: AuthorityRequest
  now?: Date
  maxLifetimeMs?: number
  clockToleranceMs?: number
}

export function canonicalizeAuthorityPayload(payload: AuthorityPayload): Buffer {
  return canonicalJsonBytes(payload)
}

export function canonicalizeIntentPayload(payload: ExecutionIntentPayload): Buffer {
  return canonicalJsonBytes(payload)
}

// Commits to the whole signed intent, signature included, so an authority
// approves exactly one signed request.
export function intentCommitmentFor(signedIntent: SignedIntent): string {
  return canonicalHash(signedIntent)
}

function verifyEd25519(message: Buffer, publicKeyPem: string, signature: string): boolean {
  return verify(null, message, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))
}

function checkWindow(
  window: { issuedAt: string; notBefore: string; expiresAt: string },
  now: Date,
  toleranceMs: number,
  maxLifetimeMs: number,
  codes: { notYetValid: AuthorityErrorCode; expired: AuthorityErrorCode; tooLong: AuthorityErrorCode },
) {
  const notBefore = Date.parse(window.notBefore)
  const expiresAt = Date.parse(window.expiresAt)
  if (now.getTime() + toleranceMs < notBefore) fail(codes.notYetValid, 'Not active yet')
  if (now.getTime() - toleranceMs > expiresAt) fail(codes.expired, 'Has expired')
  if (expiresAt - Date.parse(window.issuedAt) > maxLifetimeMs) {
    fail(codes.tooLong, 'Lifetime exceeds the short-lived maximum')
  }
}

// First signature: the requester's intent. The key must be trusted and bound
// to the principal named in the intent, and the intent must describe exactly
// the request about to execute.
export function verifyIntent(input: VerifyIntentInput): VerifiedIntent {
  const parsed = SignedIntentSchema.safeParse(input.signedIntent)
  if (!parsed.success) fail('INVALID_INTENT', 'Execution intent is invalid', { cause: parsed.error })

  const { payload, signature, algorithm } = parsed.data
  const requesterKey = input.trustedRequesterKeys.get(payload.signerKeyId)
  if (!requesterKey) fail('UNKNOWN_REQUESTER_KEY', 'Intent signer key is not trusted')
  if (requesterKey.principal !== payload.requester) {
    fail('REQUESTER_KEY_MISMATCH', 'Intent signer key is not bound to the named requester')
  }

  let authentic = false
  try {
    authentic = verifyEd25519(canonicalizeIntentPayload(payload), requesterKey.publicKeyPem, signature)
  } catch (error) {
    fail('INVALID_INTENT_SIGNATURE', 'Intent signature is invalid', { cause: error })
  }
  if (!authentic) fail('INVALID_INTENT_SIGNATURE', 'Intent signature is invalid')

  const { entitlement, request } = input
  if (payload.customerOrTenant !== entitlement.customerOrTenant || payload.audience !== entitlement.audience) {
    fail('INTENT_MISMATCH', 'Intent is not for this tenant and installation')
  }

  const now = input.now ?? new Date()
  checkWindow(
    payload,
    now,
    input.clockToleranceMs ?? DEFAULT_CLOCK_TOLERANCE_MS,
    input.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS,
    { notYetValid: 'INTENT_NOT_YET_VALID', expired: 'INTENT_EXPIRED', tooLong: 'INTENT_LIFETIME_TOO_LONG' },
  )

  if (
    payload.adapter !== request.adapter ||
    payload.targetResource !== request.targetResource ||
    payload.payloadHash !== hashAuthorityRequestPayload(request.payload) ||
    payload.decision?.decisionFrameId !== request.decision?.decisionFrameId ||
    payload.decision?.proofHash !== request.decision?.proofHash
  ) {
    fail('INTENT_MISMATCH', 'Request does not match the signed intent')
  }

  return Object.freeze({
    ...payload,
    algorithm,
    intentCommitment: intentCommitmentFor(parsed.data),
    verifiedAt: now.toISOString(),
  })
}

export function hashAuthorityRequestPayload(payload: unknown): string {
  return canonicalHash(payload)
}

function fail(code: AuthorityErrorCode, message: string, options?: ErrorOptions): never {
  throw new AuthorityVerificationError(code, message, options)
}

function checkBudget(bound: number | undefined, estimate: number | undefined, label: string) {
  if (bound === undefined) return
  if (estimate === undefined || !Number.isFinite(estimate) || estimate < 0) {
    fail('BUDGET_ESTIMATE_REQUIRED', `A non-negative ${label} estimate is required by the authority budget`)
  }
  if (estimate > bound) fail('BUDGET_EXCEEDED', `Estimated ${label} exceeds the authority budget`)
}

// Verifies a signed authority envelope against the local license and the exact
// request it is meant to authorize. Every check fails closed.
export function verifyAuthority(input: VerifyAuthorityInput): VerifiedAuthority {
  const parsed = SignedAuthoritySchema.safeParse(input.signedAuthority)
  if (!parsed.success) fail('INVALID_AUTHORITY', 'Authority envelope is invalid', { cause: parsed.error })

  const { payload, signature, algorithm } = parsed.data
  const publicKeyPem = input.trustedPublicKeys.get(payload.issuerKeyId)
  if (!publicKeyPem) fail('UNKNOWN_ISSUER_KEY', 'Authority issuer key is not trusted')

  let authentic = false
  try {
    authentic = verifyEd25519(canonicalizeAuthorityPayload(payload), publicKeyPem, signature)
  } catch (error) {
    fail('INVALID_SIGNATURE', 'Authority signature is invalid', { cause: error })
  }
  if (!authentic) fail('INVALID_SIGNATURE', 'Authority signature is invalid')

  const { entitlement, request, intent } = input
  if (payload.intentCommitment !== intent.intentCommitment) {
    fail('INTENT_COMMITMENT_MISMATCH', 'Authority does not approve this signed intent')
  }
  if (payload.requester !== intent.requester) {
    fail('INTENT_COMMITMENT_MISMATCH', 'Authority requester does not match the intent signer')
  }
  if (entitlement.edition !== 'authority') {
    fail('EDITION_NOT_AUTHORITY', 'License edition does not include Authority execution')
  }
  if (payload.licenseId !== entitlement.licenseId || payload.customerOrTenant !== entitlement.customerOrTenant) {
    fail('LICENSE_MISMATCH', 'Authority is not bound to this license and tenant')
  }
  if (payload.audience !== entitlement.audience) {
    fail('AUDIENCE_MISMATCH', 'Authority audience does not match installation')
  }
  if (!payload.scopes.includes(EXECUTE_SCOPE) || !entitlement.scopes.includes(EXECUTE_SCOPE)) {
    fail('SCOPE_MISSING', `Both the license and the authority must grant ${EXECUTE_SCOPE}`)
  }

  const now = input.now ?? new Date()
  checkWindow(
    payload,
    now,
    input.clockToleranceMs ?? DEFAULT_CLOCK_TOLERANCE_MS,
    input.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS,
    { notYetValid: 'NOT_YET_VALID', expired: 'EXPIRED', tooLong: 'LIFETIME_TOO_LONG' },
  )

  if (!payload.permittedAdapters.includes(request.adapter)) {
    fail('ADAPTER_NOT_PERMITTED', `Adapter ${request.adapter} is not permitted`)
  }
  if (!payload.targetResourceBounds.includes(request.targetResource)) {
    fail('TARGET_OUT_OF_BOUNDS', `Target ${request.targetResource} is outside the authority bounds`)
  }
  if (hashAuthorityRequestPayload(request.payload) !== payload.payloadHash) {
    fail('PAYLOAD_MISMATCH', 'Request payload does not match the authorized payload hash')
  }
  if (request.policyHash !== payload.policyHash) {
    fail('POLICY_MISMATCH', 'Active policy does not match the authorized policy hash')
  }
  if (
    payload.decision &&
    (payload.decision.decisionFrameId !== request.decision?.decisionFrameId ||
      payload.decision.proofHash !== request.decision?.proofHash)
  ) {
    fail('DECISION_MISMATCH', 'Request is not bound to the authorized CO2 Router decision')
  }
  checkBudget(payload.budgetBounds.maxEnergyKwh, request.estimatedEnergyKwh, 'energy')
  checkBudget(payload.budgetBounds.maxCostUsd, request.estimatedCostUsd, 'cost')

  return Object.freeze({ ...payload, algorithm, verifiedAt: now.toISOString() })
}
