import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar'

import { env } from '@/lib/env'
import { buildCo2RouterX402Routes } from '@/lib/x402/routes'

let serverPromise: Promise<x402HTTPResourceServer> | null = null

function buildFacilitatorClient() {
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
