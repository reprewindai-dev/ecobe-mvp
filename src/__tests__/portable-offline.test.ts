import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyPortableOffline } from '../../scripts/verify-portable-offline'

test('built stdio MCP operates without a hosted CO2 Router dependency', async () => {
  const result = await verifyPortableOffline()
  assert.deepEqual(result, {
    offlineDecisionPassed: true,
    engineRequests: 1,
    hostedRequests: 0,
    expiredLicenseRejected: true,
  })
})
