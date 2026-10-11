import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import type { RequesterKey, VerifiedAuthority, VerifiedIntent } from './authority-schema'
import {
  type AuthorityRequest,
  AuthorityVerificationError,
  hashAuthorityRequestPayload,
  verifyAuthority,
  verifyIntent,
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
  // True only if the target itself enforces expectedPreStateRoot/expectedGeneration.
  supportsConditionalMutation?: boolean
  execute(input: {
    idempotencyKey: string
    payloadHash: string
    fencingGeneration?: number
    expectedPreStateRoot?: string
    expectedGeneration?: number
  }): Promise<TargetReceipt>
  // Asks the target whether an idempotency key committed, to resolve UNKNOWN
  // outcomes from the target's own record rather than by blind retry.
  lookup?(idempotencyKey: string): Promise<TargetReceipt | 'NOT_FOUND'>
}

// Revocations checked at execution time: revoking an authority, requester key,
// or issuer key stops already-issued, unspent authorities from executing.
export type Revocations = {
  authorityIds?: ReadonlySet<string>
  requesterKeyIds?: ReadonlySet<string>
  issuerKeyIds?: ReadonlySet<string>
}

export type ExecutionStatus = 'EXECUTED' | 'DUPLICATE' | 'DENIED' | 'UNKNOWN'

export type ExecutionResult = {
  status: ExecutionStatus
  reason?: string
  authorityId?: string
  intentId?: string
  receipt?: TargetReceipt
  evidenceHead: string
}

export type ExecuteWithAuthorityInput = {
  // First signature: the requester's intent.
  signedIntent: unknown
  trustedRequesterKeys: ReadonlyMap<string, RequesterKey>
  // Second signature: the Authority's approval of that exact intent.
  signedAuthority: unknown
  trustedAuthorityKeys: ReadonlyMap<string, string>
  entitlement: VerifiedEntitlement
  request: AuthorityRequest
  adapter: TargetAdapter
  connectivity: Connectivity
  currentHumanAuthorization?: boolean
  // Deliberate retry of an already-consumed intent/authority. Only Class B2
  // targets accept it, because their idempotency key makes a repeat at-most-once.
  retry?: boolean
  revocations?: Revocations
  nonceStore: NonceStore
  evidence: EvidenceJournal
  now?: Date
}

// Runs one consequential operation under two signatures. Order matters:
// verify intent -> verify authority against it -> autonomy rule -> consume
// nonces -> record attempt -> touch target. Any failure before the target call
// denies; an ambiguous target response is recorded as UNKNOWN and must not be
// blindly retried (spec section 12).
export async function executeWithAuthority(input: ExecuteWithAuthorityInput): Promise<ExecutionResult> {
  const now = input.now ?? new Date()
  const payloadHash = hashAuthorityRequestPayload(input.request.payload)
  const deny = async (reason: string, ids: { authorityId?: string; intentId?: string } = {}): Promise<ExecutionResult> => {
    await input.evidence.append(
      'outcome',
      {
        status: 'DENIED',
        reason,
        authorityId: ids.authorityId ?? null,
        intentId: ids.intentId ?? null,
        adapter: input.adapter.id,
        payloadHash,
      },
      now,
    )
    return { status: 'DENIED', reason, ...ids, evidenceHead: input.evidence.headHash() }
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

  let intent: VerifiedIntent
  let authority: VerifiedAuthority
  try {
    intent = verifyIntent({
      signedIntent: input.signedIntent,
      trustedRequesterKeys: input.trustedRequesterKeys,
      entitlement: input.entitlement,
      request: input.request,
      now,
    })
    authority = verifyAuthority({
      signedAuthority: input.signedAuthority,
      trustedPublicKeys: input.trustedAuthorityKeys,
      entitlement: input.entitlement,
      request: input.request,
      intent,
      now,
    })
  } catch (error) {
    if (error instanceof AuthorityVerificationError) return deny(error.code)
    throw error
  }
  const ids = { authorityId: authority.authorityId, intentId: intent.intentId }

  const revoked = input.revocations
  if (revoked?.authorityIds?.has(authority.authorityId)) return deny('AUTHORITY_REVOKED', ids)
  if (revoked?.issuerKeyIds?.has(authority.issuerKeyId)) return deny('ISSUER_KEY_REVOKED', ids)
  if (revoked?.requesterKeyIds?.has(intent.signerKeyId)) return deny('REQUESTER_KEY_REVOKED', ids)

  await input.evidence.append(
    'authority',
    {
      authorityId: authority.authorityId,
      licenseId: authority.licenseId,
      actor: authority.actor,
      approvalPolicyId: authority.approvalPolicyId,
      expiresAt: authority.expiresAt,
      intentId: intent.intentId,
      intentCommitment: intent.intentCommitment,
      requester: intent.requester,
      operation: intent.operation,
      decision: authority.decision ?? null,
    },
    now,
  )

  const autonomy = autonomousExecutionAllowed({
    targetClass: input.adapter.targetClass,
    connectivity: input.connectivity,
    currentHumanAuthorization: input.currentHumanAuthorization ?? false,
  })
  if (!autonomy.allowed) return deny(autonomy.reason, ids)
  if (input.adapter.targetClass === 'B1' && authority.fencingGeneration === undefined) {
    return deny('FENCING_GENERATION_REQUIRED', ids)
  }
  const conditional = intent.expectedPreStateRoot !== undefined || intent.expectedGeneration !== undefined
  if (conditional && !input.adapter.supportsConditionalMutation) {
    // Never silently drop a compare-and-set expectation the target cannot enforce.
    return deny('CONDITIONAL_MUTATION_UNSUPPORTED', ids)
  }

  // Both the authority nonce and the intent are single-use, so a second
  // authority issued for an already-executed intent cannot run it again.
  const authorityReplayed =
    (await input.nonceStore.consume(`authority:${authority.nonce}`, new Date(authority.expiresAt), now)) === 'REPLAYED'
  const intentReplayed =
    (await input.nonceStore.consume(`intent:${intent.intentId}`, new Date(intent.expiresAt), now)) === 'REPLAYED'
  const isRetry = authorityReplayed || intentReplayed
  if (isRetry && !(input.retry === true && input.adapter.targetClass === 'B2')) {
    return deny(authorityReplayed ? 'NONCE_REPLAYED' : 'INTENT_REPLAYED', ids)
  }

  const idempotencyKey = idempotencyKeyFor(intent.intentId, payloadHash)
  await input.evidence.append(
    'execution_attempt',
    {
      ...ids,
      adapter: input.adapter.id,
      targetClass: input.adapter.targetClass,
      idempotencyKey,
      fencingGeneration: authority.fencingGeneration ?? null,
      expectedPreStateRoot: intent.expectedPreStateRoot ?? null,
      expectedGeneration: intent.expectedGeneration ?? null,
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
      expectedPreStateRoot: intent.expectedPreStateRoot,
      expectedGeneration: intent.expectedGeneration,
    })
  } catch (error) {
    await input.evidence.append(
      'outcome',
      {
        status: 'UNKNOWN',
        ...ids,
        reason: 'AMBIGUOUS_TARGET_RESPONSE',
        detail: error instanceof Error ? error.message : 'Unknown target error',
      },
      now,
    )
    return {
      status: 'UNKNOWN',
      reason: 'AMBIGUOUS_TARGET_RESPONSE',
      ...ids,
      evidenceHead: input.evidence.headHash(),
    }
  }

  await input.evidence.append('target_ack', { ...ids, ...receipt }, now)
  const status: ExecutionStatus =
    receipt.outcome === 'APPLIED' ? 'EXECUTED' : receipt.outcome === 'DUPLICATE' ? 'DUPLICATE' : 'DENIED'
  await input.evidence.append(
    'outcome',
    { status, ...ids, reason: receipt.reason ?? null, receiptHash: receipt.receiptHash },
    now,
  )
  return { status, reason: receipt.reason, ...ids, receipt, evidenceHead: input.evidence.headHash() }
}

export type ReconcileStatus = 'RECONCILED_EXECUTED' | 'RECONCILED_NOT_APPLIED' | 'UNKNOWN'

// Resolves an UNKNOWN outcome by asking the target whether the idempotency key
// committed. Only the target's own answer changes the outcome: if it cannot be
// asked or does not answer, the outcome stays UNKNOWN (never "not committed").
export async function reconcileUnknownOutcome(input: {
  adapter: TargetAdapter
  idempotencyKey: string
  ids: { authorityId?: string; intentId?: string }
  evidence: EvidenceJournal
  now?: Date
}): Promise<{ status: ReconcileStatus; receipt?: TargetReceipt }> {
  const now = input.now ?? new Date()
  let answer: TargetReceipt | 'NOT_FOUND'
  try {
    if (!input.adapter.lookup) throw new Error('Target does not support outcome lookup')
    answer = await input.adapter.lookup(input.idempotencyKey)
  } catch (error) {
    await input.evidence.append(
      'outcome',
      {
        status: 'UNKNOWN',
        ...input.ids,
        reason: 'RECONCILIATION_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'Unknown lookup error',
      },
      now,
    )
    return { status: 'UNKNOWN' }
  }

  if (answer === 'NOT_FOUND') {
    await input.evidence.append(
      'outcome',
      { status: 'RECONCILED_NOT_APPLIED', ...input.ids, idempotencyKey: input.idempotencyKey },
      now,
    )
    return { status: 'RECONCILED_NOT_APPLIED' }
  }
  await input.evidence.append('target_ack', { ...input.ids, ...answer, reconciled: true }, now)
  await input.evidence.append(
    'outcome',
    { status: 'RECONCILED_EXECUTED', ...input.ids, receiptHash: answer.receiptHash },
    now,
  )
  return { status: 'RECONCILED_EXECUTED', receipt: answer }
}
