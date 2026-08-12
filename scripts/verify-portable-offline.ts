import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import type { LicensePayload } from '../src/lib/license/license-schema'
import { canonicalizeLicensePayload } from '../src/lib/license/license-verifier'

export type PortableOfflineResult = {
  offlineDecisionPassed: boolean
  engineRequests: number
  hostedRequests: number
  expiredLicenseRejected: boolean
}

async function writeEntitlement(
  directory: string,
  expiresAt: string | null,
  audience: string,
) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload: LicensePayload = {
    licenseId: `offline-${expiresAt ? 'expiring' : 'perpetual'}`,
    product: 'co2-router',
    edition: 'router',
    customerOrTenant: 'offline-test',
    audience,
    scopes: ['route:simulate', 'proof:read', 'replay:read'],
    issuedAt: '2025-01-01T00:00:00.000Z',
    notBefore: '2025-01-01T00:00:00.000Z',
    expiresAt,
    majorVersionMin: 1,
    majorVersionMax: 1,
    issuerKeyId: 'offline-test-key',
  }
  const signature = sign(null, canonicalizeLicensePayload(payload), privateKey).toString('base64url')
  const licenseFile = path.join(directory, `license-${expiresAt ? 'expired' : 'valid'}.json`)
  const trustStoreFile = path.join(directory, 'trust-store.json')
  await Promise.all([
    writeFile(licenseFile, `${JSON.stringify({ payload, algorithm: 'Ed25519', signature })}\n`),
    writeFile(
      trustStoreFile,
      `${JSON.stringify({
        keys: [
          {
            keyId: 'offline-test-key',
            algorithm: 'Ed25519',
            publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          },
        ],
      })}\n`,
    ),
  ])
  return { licenseFile, trustStoreFile }
}

function executableEnvironment(input: {
  licenseFile: string
  trustStoreFile: string
  engineUrl: string
  audience: string
}) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    CO2ROUTER_LICENSE_FILE: input.licenseFile,
    CO2ROUTER_TRUST_STORE_FILE: input.trustStoreFile,
    CO2ROUTER_INSTALLATION_ID: input.audience,
    CO2ROUTER_PRODUCT_MAJOR_VERSION: '1',
    ECOBE_ENGINE_URL: input.engineUrl,
    ECOBE_ENGINE_INTERNAL_KEY: 'offline-internal-key',
    CO2ROUTER_X402_PUBLIC_URL: 'https://unreachable.co2router.com',
    CO2ROUTER_MCP_PUBLIC_URL: 'https://unreachable.co2router.com',
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost',
  } as Record<string, string>
}

export async function verifyPortableOffline(): Promise<PortableOfflineResult> {
  const directory = await mkdtemp(path.join(tmpdir(), 'co2router-offline-'))
  const audience = 'offline-installation'
  let engineRequests = 0
  let hostedRequests = 0
  const engine = createServer((request, response) => {
    engineRequests += 1
    const host = request.headers.host ?? ''
    if (/co2router\.com/i.test(host)) hostedRequests += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        decision: 'REROUTE',
        selectedRegion: 'ca-qc',
        proofHash: 'sha256:offline-proof',
      }),
    )
  })

  try {
    await new Promise<void>((resolve, reject) => {
      engine.once('error', reject)
      engine.listen(0, '127.0.0.1', resolve)
    })
    const address = engine.address()
    if (!address || typeof address === 'string') throw new Error('Unable to allocate loopback engine')
    const engineUrl = `http://127.0.0.1:${address.port}`
    const valid = await writeEntitlement(directory, null, audience)
    const executable = path.resolve('dist/co2router-mcp.mjs')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [executable],
      env: executableEnvironment({ ...valid, engineUrl, audience }),
      stderr: 'pipe',
    })
    let serverStderr = ''
    transport.stderr?.on('data', (chunk) => {
      serverStderr += chunk.toString()
    })
    const client = new Client({ name: 'offline-acceptance-client', version: '1.0.0' })
    try {
      await client.connect(transport)
    } catch (error) {
      throw new Error(`Built MCP executable failed to start: ${serverStderr.trim()}`, { cause: error })
    }
    let decision
    try {
      decision = await client.callTool({
        name: 'co2router_route',
        arguments: { allowedRegions: ['ca-qc', 'us-east-1'], estimatedEnergyKwh: 5 },
      })
    } finally {
      await client.close()
    }
    const decisionBody = decision.structuredContent as Record<string, unknown> | undefined
    const offlineDecisionPassed =
      decision.isError !== true &&
      decisionBody?.decision === 'REROUTE' &&
      decisionBody?.proofHash === 'sha256:offline-proof'

    const requestsBeforeExpiredLicense = engineRequests
    const expired = await writeEntitlement(directory, '2025-01-02T00:00:00.000Z', audience)
    const expiredTransport = new StdioClientTransport({
      command: process.execPath,
      args: [executable],
      env: executableEnvironment({ ...expired, engineUrl, audience }),
      stderr: 'pipe',
    })
    const expiredClient = new Client({ name: 'expired-license-client', version: '1.0.0' })
    let expiredLicenseRejected = false
    try {
      await expiredClient.connect(expiredTransport)
    } catch {
      expiredLicenseRejected = true
    } finally {
      await expiredClient.close().catch(() => undefined)
    }
    expiredLicenseRejected &&= engineRequests === requestsBeforeExpiredLicense

    return { offlineDecisionPassed, engineRequests, hostedRequests, expiredLicenseRejected }
  } finally {
    await new Promise<void>((resolve) => engine.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPortableOffline()
    .then((result) => {
      console.log(JSON.stringify(result))
      if (!Object.values(result).every((value) => value === true || value === 0 || value === 1)) {
        process.exitCode = 1
      }
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
