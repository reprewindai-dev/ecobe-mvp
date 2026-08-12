import { createPublicKey, verify } from 'node:crypto'

import {
  type LicensePayload,
  SignedLicenseSchema,
  type VerifiedEntitlement,
} from './license-schema'

export type VerifyLicenseInput = {
  signedLicense: unknown
  trustedPublicKeys: ReadonlyMap<string, string>
  expectedAudience: string
  productMajorVersion: number
  now?: Date
}

export class LicenseVerificationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_LICENSE'
      | 'UNKNOWN_ISSUER_KEY'
      | 'INVALID_SIGNATURE'
      | 'AUDIENCE_MISMATCH'
      | 'NOT_YET_VALID'
      | 'EXPIRED'
      | 'VERSION_MISMATCH',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LicenseVerificationError'
  }
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortRecursively(nested)]),
    )
  }
  return value
}

export function canonicalizeLicensePayload(payload: LicensePayload): Buffer {
  return Buffer.from(JSON.stringify(sortRecursively(payload)), 'utf8')
}

export function verifyLicense(input: VerifyLicenseInput): VerifiedEntitlement {
  const parsed = SignedLicenseSchema.safeParse(input.signedLicense)
  if (!parsed.success) {
    throw new LicenseVerificationError('INVALID_LICENSE', 'License envelope is invalid', {
      cause: parsed.error,
    })
  }

  const { payload, signature, algorithm } = parsed.data
  const publicKeyPem = input.trustedPublicKeys.get(payload.issuerKeyId)
  if (!publicKeyPem) {
    throw new LicenseVerificationError('UNKNOWN_ISSUER_KEY', 'License issuer key is not trusted')
  }

  let authentic = false
  try {
    authentic = verify(
      null,
      canonicalizeLicensePayload(payload),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    )
  } catch (error) {
    throw new LicenseVerificationError('INVALID_SIGNATURE', 'License signature is invalid', {
      cause: error,
    })
  }
  if (!authentic) {
    throw new LicenseVerificationError('INVALID_SIGNATURE', 'License signature is invalid')
  }

  if (payload.audience !== input.expectedAudience) {
    throw new LicenseVerificationError('AUDIENCE_MISMATCH', 'License audience does not match installation')
  }

  const now = input.now ?? new Date()
  if (now.getTime() < Date.parse(payload.notBefore)) {
    throw new LicenseVerificationError('NOT_YET_VALID', 'License is not active yet')
  }
  if (payload.expiresAt && now.getTime() > Date.parse(payload.expiresAt)) {
    throw new LicenseVerificationError('EXPIRED', 'License has expired')
  }
  if (
    input.productMajorVersion < payload.majorVersionMin ||
    input.productMajorVersion > payload.majorVersionMax
  ) {
    throw new LicenseVerificationError('VERSION_MISMATCH', 'License does not cover this product version')
  }

  return Object.freeze({
    ...payload,
    scopes: Object.freeze([...payload.scopes]),
    algorithm,
    verifiedAt: now.toISOString(),
  })
}
