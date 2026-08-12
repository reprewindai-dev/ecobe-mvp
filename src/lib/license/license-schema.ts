import { z } from 'zod'

export const LicensePayloadSchema = z
  .object({
    licenseId: z.string().min(1),
    product: z.literal('co2-router'),
    edition: z.enum(['router', 'authority']),
    customerOrTenant: z.string().min(1),
    audience: z.string().min(1),
    scopes: z.array(z.string().min(1)).min(1),
    issuedAt: z.string().datetime(),
    notBefore: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    majorVersionMin: z.number().int().positive(),
    majorVersionMax: z.number().int().positive(),
    issuerKeyId: z.string().min(1),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.majorVersionMin > payload.majorVersionMax) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'majorVersionMin must not exceed majorVersionMax',
        path: ['majorVersionMin'],
      })
    }
    if (new Set(payload.scopes).size !== payload.scopes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scopes must be unique',
        path: ['scopes'],
      })
    }
  })

export const SignedLicenseSchema = z
  .object({
    payload: LicensePayloadSchema,
    algorithm: z.literal('Ed25519'),
    signature: z.string().min(1),
  })
  .strict()

export const TrustStoreSchema = z
  .object({
    keys: z
      .array(
        z
          .object({
            keyId: z.string().min(1),
            algorithm: z.literal('Ed25519'),
            publicKeyPem: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((store, context) => {
    const keyIds = store.keys.map((key) => key.keyId)
    if (new Set(keyIds).size !== keyIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trust-store key IDs must be unique',
        path: ['keys'],
      })
    }
  })

export type LicensePayload = z.infer<typeof LicensePayloadSchema>
export type SignedLicense = z.infer<typeof SignedLicenseSchema>

export type VerifiedEntitlement = Readonly<
  Omit<LicensePayload, 'scopes'> & {
    scopes: readonly string[]
    algorithm: 'Ed25519'
    verifiedAt: string
  }
>
