import { createPublicKey, verify } from 'node:crypto'

import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import { type AuthorityPayload, SignedAuthoritySchema, type VerifiedAuthority } from './authority-schema'
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
  now?: Date
  maxLifetimeMs?: number
  clockToleranceMs?: number
}

export function canonicalizeAuthorityPayload(payload: AuthorityPayload): Buffer {
  return canonicalJsonBytes(payload)
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
    authentic = verify(
      null,
      canonicalizeAuthorityPayload(payload),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    )
  } catch (error) {
    fail('INVALID_SIGNATURE', 'Authority signature is invalid', { cause: error })
  }
  if (!authentic) fail('INVALID_SIGNATURE', 'Authority signature is invalid')

  const { entitlement, request } = input
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
  const tolerance = input.clockToleranceMs ?? DEFAULT_CLOCK_TOLERANCE_MS
  const notBefore = Date.parse(payload.notBefore)
  const expiresAt = Date.parse(payload.expiresAt)
  if (now.getTime() + tolerance < notBefore) fail('NOT_YET_VALID', 'Authority is not active yet')
  if (now.getTime() - tolerance > expiresAt) fail('EXPIRED', 'Authority has expired')
  if (expiresAt - Date.parse(payload.issuedAt) > (input.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS)) {
    fail('LIFETIME_TOO_LONG', 'Authority lifetime exceeds the short-lived maximum')
  }

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
