import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import type { VerifiedAuthority } from './authority-schema'
import {
  type AuthorityRequest,
  AuthorityVerificationError,
  hashAuthorityRequestPayload,
  verifyAuthority,
} from './authority-verifier'
import type { EvidenceJournal } from './evidence-chain'
import type { NonceStore } from './nonce-store'
import {
  autonomousExecutionAllowed,
  type Connectivity,
  idempotencyKeyFor,
  type TargetClass,
  type TargetReceipt,
} from './targets'

export type TargetAdapter = {
  id: string
  targetClass: TargetClass
  execute(input: { idempotencyKey: string; payloadHash: string; fencingGeneration?: number }): Promise<TargetReceipt>
}

export type ExecutionStatus = 'EXECUTED' | 'DUPLICATE' | 'DENIED' | 'UNKNOWN'

export type ExecutionResult = {
  status: ExecutionStatus
  reason?: string
  authorityId?: string
  receipt?: TargetReceipt
  evidenceHead: string
}

export type ExecuteWithAuthorityInput = {
  signedAuthority: unknown
  trustedAuthorityKeys: ReadonlyMap<string, string>
  entitlement: VerifiedEntitlement
  request: AuthorityRequest
  adapter: TargetAdapter
  connectivity: Connectivity
  currentHumanAuthorization?: boolean
  // Deliberate retry of an already-consumed authority. Only Class B2 targets
  // accept it, because their idempotency key makes a repeat at-most-once.
  retry?: boolean
  nonceStore: NonceStore
  evidence: EvidenceJournal
  now?: Date
}

// Runs one consequential operation under a signed authority. Order matters:
// verify -> autonomy rule -> consume nonce -> record attempt -> touch target.
// Any failure before the target call denies; an ambiguous target response is
// recorded as UNKNOWN and must not be blindly retried (spec section 12).
export async function executeWithAuthority(input: ExecuteWithAuthorityInput): Promise<ExecutionResult> {
  const now = input.now ?? new Date()
  const payloadHash = hashAuthorityRequestPayload(input.request.payload)
  const deny = async (reason: string, authorityId?: string): Promise<ExecutionResult> => {
    await input.evidence.append(
      'outcome',
      { status: 'DENIED', reason, authorityId: authorityId ?? null, adapter: input.adapter.id, payloadHash },
      now,
    )
    return { status: 'DENIED', reason, authorityId, evidenceHead: input.evidence.headHash() }
  }

  await input.evidence.append(
    'request',
    {
      adapter: input.adapter.id,
      targetResource: input.request.targetResource,
      payloadHash,
      policyHash: input.request.policyHash,
      decision: input.request.decision ?? null,
    },
    now,
  )

  let authority: VerifiedAuthority
  try {
    authority = verifyAuthority({
      signedAuthority: input.signedAuthority,
      trustedPublicKeys: input.trustedAuthorityKeys,
      entitlement: input.entitlement,
      request: input.request,
      now,
    })
  } catch (error) {
    if (error instanceof AuthorityVerificationError) return deny(error.code)
    throw error
  }

  await input.evidence.append(
    'authority',
    {
      authorityId: authority.authorityId,
      licenseId: authority.licenseId,
      actor: authority.actor,
      approvalPolicyId: authority.approvalPolicyId,
      expiresAt: authority.expiresAt,
      decision: authority.decision ?? null,
    },
    now,
  )

  const autonomy = autonomousExecutionAllowed({
    targetClass: input.adapter.targetClass,
    connectivity: input.connectivity,
    currentHumanAuthorization: input.currentHumanAuthorization ?? false,
  })
  if (!autonomy.allowed) return deny(autonomy.reason, authority.authorityId)
  if (input.adapter.targetClass === 'B1' && authority.fencingGeneration === undefined) {
    return deny('FENCING_GENERATION_REQUIRED', authority.authorityId)
  }

  const nonceResult = await input.nonceStore.consume(authority.nonce, new Date(authority.expiresAt), now)
  const isRetry = nonceResult === 'REPLAYED'
  if (isRetry && !(input.retry === true && input.adapter.targetClass === 'B2')) {
    return deny('NONCE_REPLAYED', authority.authorityId)
  }

  const idempotencyKey = idempotencyKeyFor(authority.authorityId, payloadHash)
  await input.evidence.append(
    'execution_attempt',
    {
      authorityId: authority.authorityId,
      adapter: input.adapter.id,
      targetClass: input.adapter.targetClass,
      idempotencyKey,
      fencingGeneration: authority.fencingGeneration ?? null,
      retry: isRetry,
    },
    now,
  )

  let receipt: TargetReceipt
  try {
    receipt = await input.adapter.execute({
      idempotencyKey,
      payloadHash,
      fencingGeneration: authority.fencingGeneration,
    })
  } catch (error) {
    await input.evidence.append(
      'outcome',
      {
        status: 'UNKNOWN',
        authorityId: authority.authorityId,
        reason: 'AMBIGUOUS_TARGET_RESPONSE',
        detail: error instanceof Error ? error.message : 'Unknown target error',
      },
      now,
    )
    return {
      status: 'UNKNOWN',
      reason: 'AMBIGUOUS_TARGET_RESPONSE',
      authorityId: authority.authorityId,
      evidenceHead: input.evidence.headHash(),
    }
  }

  await input.evidence.append('target_ack', { authorityId: authority.authorityId, ...receipt }, now)
  const status: ExecutionStatus =
    receipt.outcome === 'APPLIED' ? 'EXECUTED' : receipt.outcome === 'DUPLICATE' ? 'DUPLICATE' : 'DENIED'
  await input.evidence.append(
    'outcome',
    { status, authorityId: authority.authorityId, reason: receipt.reason ?? null, receiptHash: receipt.receiptHash },
    now,
  )
  return {
    status,
    reason: receipt.reason,
    authorityId: authority.authorityId,
    receipt,
    evidenceHead: input.evidence.headHash(),
  }
}
