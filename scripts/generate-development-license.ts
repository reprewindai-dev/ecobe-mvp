import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { type LicensePayload } from '../src/lib/license/license-schema'
import { canonicalizeLicensePayload } from '../src/lib/license/license-verifier'

const outputArgument = process.argv[2]
if (!outputArgument) {
  console.error('Usage: npx tsx scripts/generate-development-license.ts <output-directory>')
  process.exit(2)
}

const outputDirectory = path.resolve(outputArgument)
const installationId = process.env.CO2ROUTER_INSTALLATION_ID || 'co2router-development-installation'
const keyId = 'co2router-development-key'
const now = new Date()
const expiresAt = new Date(now)
expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const payload: LicensePayload = {
  licenseId: `development-${crypto.randomUUID()}`,
  product: 'co2-router',
  edition: 'router',
  customerOrTenant: 'local-development',
  audience: installationId,
  scopes: ['route:simulate', 'proof:read', 'replay:read'],
  issuedAt: now.toISOString(),
  notBefore: now.toISOString(),
  expiresAt: expiresAt.toISOString(),
  majorVersionMin: 1,
  majorVersionMax: 1,
  issuerKeyId: keyId,
}
const signature = sign(null, canonicalizeLicensePayload(payload), privateKey).toString('base64url')

await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeFile(
    path.join(outputDirectory, 'license.json'),
    `${JSON.stringify({ payload, algorithm: 'Ed25519', signature }, null, 2)}\n`,
    { mode: 0o600 },
  ),
  writeFile(
    path.join(outputDirectory, 'trust-store.json'),
    `${JSON.stringify(
      {
        keys: [
          {
            keyId,
            algorithm: 'Ed25519',
            publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          },
        ],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  ),
  writeFile(
    path.join(outputDirectory, 'development-private-key.pem'),
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  ),
])

console.error(`Development-only entitlement written to ${outputDirectory}`)
