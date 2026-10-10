import { generateKeyPairSync, sign } from 'node:crypto'

import type { AuthorityPayload } from '@/lib/authority/authority-schema'
import {
  type AuthorityRequest,
  canonicalizeAuthorityPayload,
  EXECUTE_SCOPE,
  hashAuthorityRequestPayload,
} from '@/lib/authority/authority-verifier'
import { canonicalHash } from '@/lib/authority/canonical'
import type { VerifiedEntitlement } from '@/lib/license/license-schema'

export const NOW = new Date('2026-10-10T12:00:00.000Z')
export const requestPayload = { action: 'shift-batch', region: 'eu-west-1', jobs: 4 }
export const policyHash = canonicalHash({ policy: 'default-doctrine', version: 1 })
export const decision = { decisionFrameId: 'frame-1', proofHash: canonicalHash({ proof: 'frame-1' }) }

const keys = generateKeyPairSync('ed25519')
export const trustedPublicKeys = new Map([
  ['authority-key-1', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()],
])

export const entitlement: VerifiedEntitlement = Object.freeze({
  licenseId: 'license-1',
  product: 'co2-router',
  edition: 'authority',
  customerOrTenant: 'tenant-1',
  audience: 'installation-1',
  scopes: Object.freeze(['route:simulate', EXECUTE_SCOPE]),
  issuedAt: '2026-10-01T00:00:00.000Z',
  notBefore: '2026-10-01T00:00:00.000Z',
  expiresAt: '2027-10-01T00:00:00.000Z',
  majorVersionMin: 1,
  majorVersionMax: 1,
  issuerKeyId: 'license-key-1',
  algorithm: 'Ed25519',
  verifiedAt: '2026-10-10T11:00:00.000Z',
})

export function authorityPayload(overrides: Partial<AuthorityPayload> = {}): AuthorityPayload {
  return {
    authorityId: 'authority-1',
    licenseId: 'license-1',
    customerOrTenant: 'tenant-1',
    audience: 'installation-1',
    actor: 'agent:ci-runner',
    requester: 'user:operator-1',
    scopes: [EXECUTE_SCOPE],
    permittedAdapters: ['batch-scheduler'],
    targetResourceBounds: ['eu-west-1/batch-queue'],
    budgetBounds: { maxEnergyKwh: 20 },
    approvalPolicyId: 'policy:human-approved',
    payloadHash: hashAuthorityRequestPayload(requestPayload),
    policyHash,
    decision,
    issuedAt: '2026-10-10T11:55:00.000Z',
    notBefore: '2026-10-10T11:55:00.000Z',
    expiresAt: '2026-10-10T12:05:00.000Z',
    nonce: 'nonce-0123456789abcdef',
    issuerKeyId: 'authority-key-1',
    ...overrides,
  }
}

export function signedAuthority(payload: AuthorityPayload) {
  const signature = sign(null, canonicalizeAuthorityPayload(payload), keys.privateKey).toString('base64url')
  return { payload, algorithm: 'Ed25519' as const, signature }
}

export const request: AuthorityRequest = {
  adapter: 'batch-scheduler',
  targetResource: 'eu-west-1/batch-queue',
  payload: requestPayload,
  policyHash,
  decision,
  estimatedEnergyKwh: 12,
}
