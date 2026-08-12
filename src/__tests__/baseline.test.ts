import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const nextConfig = require('../../next.config.js') as {
  typescript?: { ignoreBuildErrors?: boolean }
}

test('production build never ignores TypeScript errors', () => {
  assert.notEqual(nextConfig.typescript?.ignoreBuildErrors, true)
})
