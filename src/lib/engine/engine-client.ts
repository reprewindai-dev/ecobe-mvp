import { createHmac } from 'node:crypto'

import { env, getEngineBaseUrl } from '@/lib/env'
import type { EngineTransport } from '@/lib/mcp/tool-executor'

type FetchLike = typeof fetch

export type EngineTransportOptions = {
  baseUrl?: string
  internalKey?: string
  brokerId?: string
  signatureSecret?: string
  timeoutMs?: number
  environment?: string
  fetchImplementation?: FetchLike
}

const SIGNED_DECISION_PATHS = new Set(['ci/route', 'ci/authorize', 'ci/carbon-route'])

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true
  if (/^10(?:\.\d{1,3}){3}$/.test(normalized)) return true
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(normalized)) return true
  const match172 = normalized.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/)
  if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true
  return /^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f:]*$/i.test(normalized)
}

export function validateEngineBaseUrl(rawBaseUrl: string, environment: string) {
  let baseUrl: URL
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch (error) {
    throw new Error('ECOBE_ENGINE_URL must be an absolute HTTP(S) URL', { cause: error })
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('ECOBE_ENGINE_URL must use HTTP or HTTPS')
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('ECOBE_ENGINE_URL must not contain credentials, query parameters, or fragments')
  }
  if (environment === 'production' && baseUrl.protocol !== 'https:' && !isPrivateHostname(baseUrl.hostname)) {
    throw new Error('Production engine HTTP is allowed only for loopback or private-network addresses')
  }
  return baseUrl
}

function responseBody(response: Response) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

export function createEngineTransport(options: EngineTransportOptions = {}): EngineTransport {
  const baseUrlText = options.baseUrl ?? getEngineBaseUrl()
  const internalKey = options.internalKey ?? env.ECOBE_ENGINE_INTERNAL_KEY
  if (!baseUrlText) throw new Error('ECOBE_ENGINE_URL is required for portable MCP execution')
  if (!internalKey) throw new Error('ECOBE_ENGINE_INTERNAL_KEY is required for portable MCP execution')

  const baseUrl = validateEngineBaseUrl(baseUrlText, options.environment ?? env.NODE_ENV)
  const brokerId = options.brokerId ?? env.ECOBE_BROKER_ID
  const signatureSecret = options.signatureSecret ?? process.env.DECISION_API_SIGNATURE_SECRET
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 12_000, 2_000), 60_000)
  const fetchImplementation = options.fetchImplementation ?? fetch

  return {
    async request(input) {
      if (!/^[a-zA-Z0-9/_-]+$/.test(input.path) || input.path.includes('..')) {
        throw new Error('Engine path is invalid')
      }
      const target = new URL(`api/v1/${input.path.replace(/^\/+/, '')}`, `${baseUrl.toString().replace(/\/+$/, '')}/`)
      const headers = new Headers({
        accept: 'application/json',
        authorization: `Bearer ${internalKey}`,
        'content-type': 'application/json',
        'x-api-key': internalKey,
        'x-ecobe-broker-id': brokerId,
        'x-ecobe-internal-key': internalKey,
        'x-request-id': input.requestId,
      })
      const body = input.method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined
      if (body && signatureSecret && SIGNED_DECISION_PATHS.has(input.path)) {
        headers.set('x-ecobe-signature', `v1=${createHmac('sha256', signatureSecret).update(body).digest('hex')}`)
      }

      const response = await fetchImplementation(target, {
        method: input.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
      return { status: response.status, body: await responseBody(response) }
    },
  }
}
