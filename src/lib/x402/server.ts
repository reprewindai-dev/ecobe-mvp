import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar'

import { DEFAULT_X402_FACILITATOR_URL, env } from '@/lib/env'
import { buildCo2RouterX402Routes } from '@/lib/x402/routes'

let serverPromise: Promise<x402HTTPResourceServer> | null = null

/** Networks the public x402.org facilitator settles; it is testnet-only. */
const PUBLIC_FACILITATOR_NETWORKS = new Set(['eip155:84532'])

/** CDP hosted facilitator, the only one that settles Base mainnet. */
export const CDP_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402'

export function cdpFacilitatorConfigured() {
  return Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET)
}

async function cdpEndpointAuthHeaders(path: string, method: 'GET' | 'POST') {
  const jwt = await generateJwt({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    requestMethod: method,
    requestHost: new URL(CDP_FACILITATOR_URL).host,
    requestPath: path,
  })
  return { Authorization: `Bearer ${jwt}` }
}

function buildCdpFacilitatorClient() {
  const basePath = new URL(CDP_FACILITATOR_URL).pathname.replace(/\/$/, '')
  return new HTTPFacilitatorClient({
    url: CDP_FACILITATOR_URL,
    createAuthHeaders: async () => {
      const [verify, settle, supported] = await Promise.all([
        cdpEndpointAuthHeaders(`${basePath}/verify`, 'POST'),
        cdpEndpointAuthHeaders(`${basePath}/settle`, 'POST'),
        cdpEndpointAuthHeaders(`${basePath}/supported`, 'GET'),
      ])
      return { verify, settle, supported }
    },
  })
}

function buildFacilitatorClient() {
  if (cdpFacilitatorConfigured()) {
    return buildCdpFacilitatorClient()
  }

  const bearerToken = env.CO2ROUTER_X402_FACILITATOR_BEARER_TOKEN
  return new HTTPFacilitatorClient({
    url: env.CO2ROUTER_X402_FACILITATOR_URL,
    ...(bearerToken
      ? {
          createAuthHeaders: async () => {
            const authorization = { authorization: `Bearer ${bearerToken}` }
            return {
              verify: authorization,
              settle: authorization,
              supported: authorization,
              bazaar: authorization,
            }
          },
        }
      : {}),
  })
}

export function x402GatewayConfigured() {
  return Boolean(env.CO2ROUTER_X402_ENABLED && env.CO2ROUTER_PAY_TO)
}

/** Returns actionable detail when the given facilitator cannot settle the given network. */
export function describeFacilitatorMisconfiguration(config: {
  cdpConfigured: boolean
  facilitatorUrl: string
  network: string
}): string | null {
  if (config.cdpConfigured) {
    return null
  }
  if (config.facilitatorUrl !== DEFAULT_X402_FACILITATOR_URL) {
    return null
  }
  if (PUBLIC_FACILITATOR_NETWORKS.has(config.network)) {
    return null
  }
  return `The default facilitator ${DEFAULT_X402_FACILITATOR_URL} cannot settle ${config.network}. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET to use the CDP facilitator, or point CO2ROUTER_X402_FACILITATOR_URL at a facilitator that supports this network.`
}

export function x402FacilitatorMisconfiguration(): string | null {
  return describeFacilitatorMisconfiguration({
    cdpConfigured: cdpFacilitatorConfigured(),
    facilitatorUrl: env.CO2ROUTER_X402_FACILITATOR_URL,
    network: env.CO2ROUTER_X402_NETWORK,
  })
}

export function resetX402ServerForTests() {
  serverPromise = null
}

export function getX402Server() {
  if (!x402GatewayConfigured()) {
    throw new Error('CO2 Router x402 gateway is not configured. Set CO2ROUTER_PAY_TO.')
  }

  if (!serverPromise) {
    serverPromise = (async () => {
      const resourceServer = new x402ResourceServer(buildFacilitatorClient())
        .register(env.CO2ROUTER_X402_NETWORK as never, new ExactEvmScheme())
        .registerExtension(bazaarResourceServerExtension)

      const httpServer = new x402HTTPResourceServer(resourceServer, buildCo2RouterX402Routes())
      await httpServer.initialize()
      return httpServer
    })()
  }

  return serverPromise
}
