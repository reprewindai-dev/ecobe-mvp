import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_X402_FACILITATOR_URL } from '@/lib/env'
import { describeFacilitatorMisconfiguration } from '@/lib/x402/server'

test('base mainnet on the default facilitator is reported as misconfigured', () => {
  const detail = describeFacilitatorMisconfiguration({
    cdpConfigured: false,
    facilitatorUrl: DEFAULT_X402_FACILITATOR_URL,
    network: 'eip155:8453',
  })

  assert.ok(detail)
  assert.match(detail, /eip155:8453/)
  assert.match(detail, /CDP_API_KEY_ID/)
})

test('cdp credentials clear the default facilitator restriction', () => {
  assert.equal(
    describeFacilitatorMisconfiguration({
      cdpConfigured: true,
      facilitatorUrl: DEFAULT_X402_FACILITATOR_URL,
      network: 'eip155:8453',
    }),
    null,
  )
})

test('base sepolia is settleable by the default facilitator', () => {
  assert.equal(
    describeFacilitatorMisconfiguration({
      cdpConfigured: false,
      facilitatorUrl: DEFAULT_X402_FACILITATOR_URL,
      network: 'eip155:84532',
    }),
    null,
  )
})

test('a self-hosted facilitator is trusted for any network', () => {
  assert.equal(
    describeFacilitatorMisconfiguration({
      cdpConfigured: false,
      facilitatorUrl: 'https://facilitator.internal.co2router.com',
      network: 'eip155:8453',
    }),
    null,
  )
})
