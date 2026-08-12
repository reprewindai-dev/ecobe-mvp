import { readFile } from 'node:fs/promises'

import { env } from '@/lib/env'

import { TrustStoreSchema } from './license-schema'
import { verifyLicense } from './license-verifier'

export type LoadLocalEntitlementOptions = {
  licenseFile?: string
  trustStoreFile?: string
  installationId?: string
  productMajorVersion?: number
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Unable to load ${label} from ${path}`, { cause: error })
  }
}

export async function loadLocalEntitlement(options: LoadLocalEntitlementOptions = {}) {
  const licenseFile = options.licenseFile ?? env.CO2ROUTER_LICENSE_FILE
  const trustStoreFile = options.trustStoreFile ?? env.CO2ROUTER_TRUST_STORE_FILE
  const installationId = options.installationId ?? env.CO2ROUTER_INSTALLATION_ID
  const productMajorVersion =
    options.productMajorVersion ?? env.CO2ROUTER_PRODUCT_MAJOR_VERSION

  if (!licenseFile || !trustStoreFile || !installationId) {
    throw new Error(
      'Local entitlement requires CO2ROUTER_LICENSE_FILE, CO2ROUTER_TRUST_STORE_FILE, and CO2ROUTER_INSTALLATION_ID',
    )
  }
  if (!Number.isSafeInteger(productMajorVersion) || productMajorVersion < 1) {
    throw new Error('CO2ROUTER_PRODUCT_MAJOR_VERSION must be a positive integer')
  }

  const [signedLicense, rawTrustStore] = await Promise.all([
    readJson(licenseFile, 'license'),
    readJson(trustStoreFile, 'trust store'),
  ])
  const trustStore = TrustStoreSchema.parse(rawTrustStore)
  const trustedPublicKeys = new Map(
    trustStore.keys.map((key) => [key.keyId, key.publicKeyPem] as const),
  )

  return verifyLicense({
    signedLicense,
    trustedPublicKeys,
    expectedAudience: installationId,
    productMajorVersion,
  })
}
