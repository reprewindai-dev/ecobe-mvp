import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

import { canonicalizeLicensePayload, verifyLicense } from '@/lib/license/license-verifier'

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload = {
    licenseId: 'license-test-1',
    product: 'co2-router' as const,
    edition: 'router' as const,
    customerOrTenant: 'customer-test',
    audience: 'installation-test',
    scopes: ['route:simulate', 'proof:read'],
    issuedAt: '2026-08-12T12:00:00.000Z',
    notBefore: '2026-08-12T12:00:00.000Z',
    expiresAt: '2027-08-12T12:00:00.000Z',
    majorVersionMin: 1,
    majorVersionMax: 1,
    issuerKeyId: 'development-key-1',
  }
  const signature = sign(null, canonicalizeLicensePayload(payload), privateKey).toString('base64url')

  return {
    payload,
    signedLicense: { payload, algorithm: 'Ed25519' as const, signature },
    trustedPublicKeys: new Map([
      ['development-key-1', publicKey.export({ type: 'spki', format: 'pem' }).toString()],
    ]),
  }
}

function verify(overrides: Record<string, unknown> = {}) {
  const value = fixture()
  return verifyLicense({
    signedLicense: value.signedLicense,
    trustedPublicKeys: value.trustedPublicKeys,
    expectedAudience: 'installation-test',
    productMajorVersion: 1,
    now: new Date('2026-08-12T12:01:00.000Z'),
    ...overrides,
  })
}

test('verifies an authentic locally trusted entitlement', () => {
  const entitlement = verify()
  assert.equal(entitlement.licenseId, 'license-test-1')
  assert.deepEqual([...entitlement.scopes], ['route:simulate', 'proof:read'])
})

test('rejects a signed payload modified after issuance', () => {
  const value = fixture()
  assert.throws(() =>
    verify({
      signedLicense: {
        ...value.signedLicense,
        payload: { ...value.payload, scopes: [...value.payload.scopes, 'admin:write'] },
      },
      trustedPublicKeys: value.trustedPublicKeys,
    }),
  )
})

test('rejects audience, activation, expiry, key, and major-version violations', () => {
  assert.throws(() => verify({ expectedAudience: 'another-installation' }))
  assert.throws(() => verify({ now: new Date('2026-08-12T11:59:59.000Z') }))
  assert.throws(() => verify({ now: new Date('2027-08-12T12:00:00.001Z') }))
  assert.throws(() => verify({ trustedPublicKeys: new Map() }))
  assert.throws(() => verify({ productMajorVersion: 2 }))
})
