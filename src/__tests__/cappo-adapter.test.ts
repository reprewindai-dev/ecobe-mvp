import assert from 'node:assert/strict'
import test from 'node:test'

import { CappoTargetAdapter } from '@/lib/authority/adapters/cappo-adapter'

test('CappoTargetAdapter: rejects execution without fencingGeneration (Class B1 requirement)', async () => {
  const adapter = new CappoTargetAdapter({
    baseUrl: 'http://127.0.0.1:8002',
    mountId: 'test-mount-001',
  })

  const receipt = await adapter.execute({
    idempotencyKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    payloadHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    fencingGeneration: undefined,
  })

  assert.equal(receipt.outcome, 'REJECTED')
  assert.equal(receipt.reason, 'FENCING_GENERATION_REQUIRED')
  assert.equal(receipt.targetClass, 'B1')
  assert.equal(receipt.mutationSequence, null)
  assert.ok(receipt.receiptHash)
})

test('CappoTargetAdapter: maps CAPPO stale_authority_epoch refusal to REJECTED receipt', async () => {
  const adapter = new CappoTargetAdapter({
    baseUrl: 'http://127.0.0.1:8002',
    mountId: 'test-mount-001',
  })

  // Mock global fetch to simulate CAPPO port 8002 response
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          decision: 'deny',
          reason: 'stale_authority_epoch',
          error_summary: 'stale_authority_epoch',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const receipt = await adapter.execute({
      idempotencyKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payloadHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      fencingGeneration: 1, // Stale generation
    })

    assert.equal(receipt.outcome, 'REJECTED')
    assert.equal(receipt.reason, 'stale_authority_epoch')
    assert.equal(receipt.targetClass, 'B1')
    assert.equal(receipt.mutationSequence, null)
    assert.ok(receipt.receiptHash)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CappoTargetAdapter: maps CAPPO allow to APPLIED receipt', async () => {
  const adapter = new CappoTargetAdapter({
    baseUrl: 'http://127.0.0.1:8002',
    mountId: 'test-mount-001',
  })

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          decision: 'allow',
          receipt_id: 'cappo-receipt-12345',
          version: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const receipt = await adapter.execute({
      idempotencyKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payloadHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      fencingGeneration: 2,
    })

    assert.equal(receipt.outcome, 'APPLIED')
    assert.equal(receipt.targetClass, 'B1')
    assert.equal(receipt.mutationSequence, 2)
    assert.ok(receipt.receiptHash)
  } finally {
    globalThis.fetch = originalFetch
  }
})
