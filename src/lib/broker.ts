import { createHmac, randomUUID } from 'crypto'

import { env, getEngineBaseUrl } from './env'

export const BROKER_REPO_NAME = 'ecobe-mvp'
export const BROKER_PRODUCT_NAME = 'CO2 Router'
export const BROKER_CONSOLE_NAME = 'HaloGrid'
export const BROKER_RESPONSE_LAYER = 'broker'
export const BROKER_IDENTITY_VERSION = process.env.npm_package_version ?? '1.0.0'

type BrokeredEngineIntent =
  | 'routing-decision-create'
  | 'routing-decision-execute'
  | 'routing-decision-fetch'
  | 'health'

const ALLOWED_ENGINE_PATHS = [
  /^\/internal\/v1\/health$/,
  /^\/internal\/v1\/routing-decisions$/,
  /^\/internal\/v1\/routing-decisions\/[^/]+$/,
  /^\/internal\/v1\/routing-decisions\/[^/]+\/execute$/,
]

export function assertEnginePathAllowed(pathname: string) {
  if (!ALLOWED_ENGINE_PATHS.some((pattern) => pattern.test(pathname))) {
    throw new Error(`Blocked non-broker engine path: ${pathname}`)
  }
}

export function createBrokerResponseHeaders(existing?: HeadersInit) {
  const headers = new Headers(existing)
  headers.set('x-ecobe-broker', BROKER_REPO_NAME)
  headers.set('x-ecobe-product', BROKER_PRODUCT_NAME)
  headers.set('x-ecobe-console', BROKER_CONSOLE_NAME)
  headers.set('x-ecobe-response-layer', BROKER_RESPONSE_LAYER)
  headers.set('x-ecobe-broker-version', BROKER_IDENTITY_VERSION)
  return headers
}

export function createEngineBrokerHeaders(input: {
  intent: BrokeredEngineIntent
  method: string
  pathname: string
  body?: string | null
}) {
  const timestamp = new Date().toISOString()
  const requestId = randomUUID()
  const body = input.body ?? ''
  const signature = createHmac('sha256', env.ECOBE_ENGINE_INTERNAL_KEY)
    .update(`${input.method.toUpperCase()}\n${input.pathname}\n${timestamp}\n${requestId}\n${body}`)
    .digest('hex')

  const headers = new Headers({
    authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
    'x-ecobe-broker': BROKER_REPO_NAME,
    'x-ecobe-product': BROKER_PRODUCT_NAME,
    'x-ecobe-console': BROKER_CONSOLE_NAME,
    'x-ecobe-broker-version': BROKER_IDENTITY_VERSION,
    'x-ecobe-broker-intent': input.intent,
    'x-ecobe-broker-request-id': requestId,
    'x-ecobe-broker-timestamp': timestamp,
    'x-ecobe-broker-signature': signature,
  })

  if (body) {
    headers.set('content-type', 'application/json')
  }

  return headers
}

export async function brokeredEngineFetch(input: {
  path: string
  intent: BrokeredEngineIntent
  method?: string
  body?: string | null
  headers?: HeadersInit
}) {
  const engineBaseUrl = getEngineBaseUrl()
  if (!engineBaseUrl || !env.ECOBE_ENGINE_INTERNAL_KEY) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }

  const url = new URL(input.path, engineBaseUrl)
  assertEnginePathAllowed(url.pathname)

  const headers = createEngineBrokerHeaders({
    intent: input.intent,
    method: input.method ?? 'GET',
    pathname: url.pathname,
    body: input.body,
  })

  const passthrough = new Headers(input.headers)
  passthrough.forEach((value, key) => {
    if (key.toLowerCase() === 'authorization') {
      return
    }
    if (key.toLowerCase().startsWith('x-ecobe-')) {
      return
    }
    headers.set(key, value)
  })

  return fetch(url, {
    method: input.method ?? 'GET',
    headers,
    body: input.body ?? undefined,
    cache: 'no-store',
  })
}
