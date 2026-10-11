import assert from 'node:assert/strict'
import test from 'node:test'

import { generateKeyPairSync } from 'node:crypto'

import type { AuthorityPayload, VerifiedIntent } from '@/lib/authority/authority-schema'
import {
  type AuthorityRequest,
  AuthorityVerificationError,
  verifyAuthority,
  verifyIntent,
} from '@/lib/authority/authority-verifier'
import { canonicalHash } from '@/lib/authority/canonical'
import type { VerifiedEntitlement } from '@/lib/license/license-schema'

import {
  authorityPayload,
  decision,
  defaultSignedIntent,
  entitlement,
  intentPayload,
  NOW,
  policyHash,
  request,
  requestPayload,
  signedAuthority as signed,
  signedIntent,
  trustedPublicKeys,
  trustedRequesterKeys,
} from './helpers/authority-fixture'

function verifyIntentWith(overrides: { signedIntent?: unknown; request?: Partial<AuthorityRequest>; now?: Date; entitlement?: Partial<VerifiedEntitlement> } = {}) {
  return verifyIntent({
    signedIntent: overrides.signedIntent ?? defaultSignedIntent,
    trustedRequesterKeys,
    entitlement: { ...entitlement, ...overrides.entitlement } as VerifiedEntitlement,
    request: { ...request, ...overrides.request },
    now: overrides.now ?? NOW,
  })
}

const defaultVerifiedIntent = verifyIntentWith()

function verifyWith(overrides: { signedAuthority?: unknown; request?: Partial<AuthorityRequest>; now?: Date; entitlement?: Partial<VerifiedEntitlement>; intent?: VerifiedIntent } = {}) {
  return verifyAuthority({
    signedAuthority: overrides.signedAuthority ?? signed(authorityPayload()),
    trustedPublicKeys,
    entitlement: { ...entitlement, ...overrides.entitlement } as VerifiedEntitlement,
    request: { ...request, ...overrides.request },
    intent: overrides.intent ?? defaultVerifiedIntent,
    now: overrides.now ?? NOW,
  })
}

function rejectsWith(code: string, run: () => unknown) {
  assert.throws(run, (error: unknown) => error instanceof AuthorityVerificationError && error.code === code)
}

test('verifies an authentic, in-bounds authority bound to its decision', () => {
  const authority = verifyWith()
  assert.equal(authority.authorityId, 'authority-1')
  assert.equal(authority.decision?.decisionFrameId, 'frame-1')
})

test('gate 5: an expired authority is rejected', () => {
  rejectsWith('EXPIRED', () => verifyWith({ now: new Date('2026-10-10T12:06:00.000Z') }))
  rejectsWith('NOT_YET_VALID', () => verifyWith({ now: new Date('2026-10-10T11:50:00.000Z') }))
})

test('gate 6: altering license, authority, payload, policy, audience, expiry, or signature is rejected', () => {
  const original = signed(authorityPayload())
  rejectsWith('LICENSE_MISMATCH', () => verifyWith({ entitlement: { licenseId: 'license-2' } }))
  rejectsWith('INVALID_SIGNATURE', () =>
    verifyWith({ signedAuthority: { ...original, payload: { ...original.payload, targetResourceBounds: ['*'] } } }),
  )
  rejectsWith('PAYLOAD_MISMATCH', () => verifyWith({ request: { payload: { ...requestPayload, jobs: 400 } } }))
  rejectsWith('POLICY_MISMATCH', () => verifyWith({ request: { policyHash: canonicalHash({ policy: 'other' }) } }))
  rejectsWith('AUDIENCE_MISMATCH', () => verifyWith({ entitlement: { audience: 'installation-2' } }))
  rejectsWith('INVALID_SIGNATURE', () =>
    verifyWith({ signedAuthority: { ...original, payload: { ...original.payload, expiresAt: '2026-10-11T12:00:00.000Z' } } }),
  )
  const flipped = Buffer.from(original.signature, 'base64url')
  flipped[0] ^= 1
  rejectsWith('INVALID_SIGNATURE', () =>
    verifyWith({ signedAuthority: { ...original, signature: flipped.toString('base64url') } }),
  )
})

test('rejects untrusted issuers, the router edition, and missing execute scope', () => {
  rejectsWith('UNKNOWN_ISSUER_KEY', () => verifyWith({ signedAuthority: signed(authorityPayload({ issuerKeyId: 'other-key' })) }))
  rejectsWith('EDITION_NOT_AUTHORITY', () => verifyWith({ entitlement: { edition: 'router' } }))
  rejectsWith('SCOPE_MISSING', () => verifyWith({ entitlement: { scopes: ['route:simulate'] } }))
})

test('enforces adapter, target, lifetime, decision binding, and budget bounds', () => {
  rejectsWith('ADAPTER_NOT_PERMITTED', () => verifyWith({ request: { adapter: 'cloud-api' } }))
  rejectsWith('TARGET_OUT_OF_BOUNDS', () => verifyWith({ request: { targetResource: 'us-east-1/batch-queue' } }))
  rejectsWith('LIFETIME_TOO_LONG', () =>
    verifyWith({ signedAuthority: signed(authorityPayload({ expiresAt: '2026-10-10T13:00:00.000Z' })) }),
  )
  rejectsWith('DECISION_MISMATCH', () =>
    verifyWith({ request: { decision: { ...decision, decisionFrameId: 'frame-2' } } }),
  )
  rejectsWith('BUDGET_EXCEEDED', () => verifyWith({ request: { estimatedEnergyKwh: 25 } }))
  rejectsWith('BUDGET_ESTIMATE_REQUIRED', () => verifyWith({ request: { estimatedEnergyKwh: undefined } }))
})

test('first signature: verifies an intent signed by a trusted, principal-bound requester key', () => {
  assert.equal(defaultVerifiedIntent.intentId, 'intent-1')
  assert.match(defaultVerifiedIntent.intentCommitment, /^[0-9a-f]{64}$/)
})

test('first signature: rejects forged, foreign, mismatched, or expired intents', () => {
  const flipped = Buffer.from(defaultSignedIntent.signature, 'base64url')
  flipped[0] ^= 1
  rejectsWith('INVALID_INTENT_SIGNATURE', () =>
    verifyIntentWith({ signedIntent: { ...defaultSignedIntent, signature: flipped.toString('base64url') } }),
  )
  rejectsWith('INVALID_INTENT_SIGNATURE', () =>
    verifyIntentWith({ signedIntent: { ...defaultSignedIntent, payload: { ...defaultSignedIntent.payload, operation: 'delete-all' } } }),
  )
  const strangerKey = generateKeyPairSync('ed25519').privateKey
  rejectsWith('INVALID_INTENT_SIGNATURE', () => verifyIntentWith({ signedIntent: signedIntent(intentPayload(), strangerKey) }))
  rejectsWith('UNKNOWN_REQUESTER_KEY', () =>
    verifyIntentWith({ signedIntent: signedIntent(intentPayload({ signerKeyId: 'unknown-key' })) }),
  )
  // A trusted key cannot sign on behalf of a different principal.
  rejectsWith('REQUESTER_KEY_MISMATCH', () =>
    verifyIntentWith({ signedIntent: signedIntent(intentPayload({ requester: 'agent:someone-else' })) }),
  )
  rejectsWith('INTENT_MISMATCH', () => verifyIntentWith({ entitlement: { customerOrTenant: 'tenant-2' } }))
  rejectsWith('INTENT_MISMATCH', () => verifyIntentWith({ request: { targetResource: 'us-east-1/batch-queue' } }))
  rejectsWith('INTENT_MISMATCH', () => verifyIntentWith({ request: { payload: { ...requestPayload, jobs: 400 } } }))
  rejectsWith('INTENT_MISMATCH', () => verifyIntentWith({ request: { decision: { ...decision, decisionFrameId: 'frame-2' } } }))
  rejectsWith('INTENT_EXPIRED', () => verifyIntentWith({ now: new Date('2026-10-10T12:06:00.000Z') }))
})

test('second signature: an authority approves only the exact signed intent it commits to', () => {
  const otherIntent = verifyIntentWith({
    signedIntent: signedIntent(intentPayload({ intentId: 'intent-2', nonce: 'intent-nonce-other-123456' })),
  })
  rejectsWith('INTENT_COMMITMENT_MISMATCH', () => verifyWith({ intent: otherIntent }))
  rejectsWith('INTENT_COMMITMENT_MISMATCH', () =>
    verifyWith({ signedAuthority: signed(authorityPayload({ requester: 'agent:someone-else' })) }),
  )
  rejectsWith('INVALID_AUTHORITY', () =>
    verifyWith({ signedAuthority: signed({ ...authorityPayload(), intentCommitment: 'not-a-hash' }) }),
  )
})

test('rejects malformed envelopes before any cryptography', () => {
  rejectsWith('INVALID_AUTHORITY', () => verifyWith({ signedAuthority: { payload: {}, algorithm: 'Ed25519', signature: 'x' } }))
  rejectsWith('INVALID_AUTHORITY', () =>
    verifyWith({ signedAuthority: signed(authorityPayload({ budgetBounds: {} as AuthorityPayload['budgetBounds'] })) }),
  )
})
