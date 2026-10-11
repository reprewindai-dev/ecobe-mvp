import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { AuthorityPayload, ExecutionIntentPayload } from '@/lib/authority/authority-schema'
import { EvidenceJournal, verifyEvidenceRecords } from '@/lib/authority/evidence-chain'
import { executeWithAuthority, type TargetAdapter } from '@/lib/authority/executor'
import { FileNonceStore } from '@/lib/authority/nonce-store'
import { FencedTargetFixture, GENESIS_STATE_ROOT, IdempotentTargetFixture } from '@/lib/authority/targets'

import {
  entitlement,
  intentAndAuthority,
  NOW,
  request,
  trustedPublicKeys,
  trustedRequesterKeys,
} from './helpers/authority-fixture'

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), 'co2router-authority-'))
  return {
    directory,
    noncePath: path.join(directory, 'nonces.jsonl'),
    evidencePath: path.join(directory, 'evidence.jsonl'),
    targetPath: path.join(directory, 'target.jsonl'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

function b2Adapter(target: IdempotentTargetFixture, supportsConditionalMutation = true): TargetAdapter {
  return {
    id: 'batch-scheduler',
    targetClass: 'B2',
    supportsConditionalMutation,
    execute: ({ idempotencyKey, payloadHash, expectedPreStateRoot, expectedGeneration }) =>
      target.apply(idempotencyKey, payloadHash, { expectedPreStateRoot, expectedGeneration }),
  }
}

function b1Adapter(target: FencedTargetFixture): TargetAdapter {
  return {
    id: 'batch-scheduler',
    targetClass: 'B1',
    execute: async ({ idempotencyKey, fencingGeneration }) => target.apply(fencingGeneration ?? -1, idempotencyKey),
  }
}

async function run(
  ws: Awaited<ReturnType<typeof workspace>>,
  adapter: TargetAdapter,
  overrides: {
    intent?: Partial<ExecutionIntentPayload>
    payload?: Partial<AuthorityPayload>
    retry?: boolean
    connectivity?: 'CONFIRMED' | 'PARTITIONED' | 'AMBIGUOUS'
    human?: boolean
    now?: Date
  } = {},
) {
  const pair = intentAndAuthority(overrides.intent, overrides.payload)
  return executeWithAuthority({
    signedIntent: pair.intent,
    trustedRequesterKeys,
    signedAuthority: pair.authority,
    trustedAuthorityKeys: trustedPublicKeys,
    entitlement,
    request,
    adapter,
    connectivity: overrides.connectivity ?? 'CONFIRMED',
    currentHumanAuthorization: overrides.human,
    retry: overrides.retry,
    nonceStore: await FileNonceStore.open(ws.noncePath, NOW),
    evidence: await EvidenceJournal.open(ws.evidencePath),
    now: overrides.now ?? NOW,
  })
}

test('executes once under a valid authority and records a verifiable evidence chain', async () => {
  const ws = await workspace()
  try {
    const target = await IdempotentTargetFixture.open(ws.targetPath)
    const result = await run(ws, b2Adapter(target))
    assert.equal(result.status, 'EXECUTED')
    assert.equal(target.mutationCount(), 1)

    const evidence = await EvidenceJournal.open(ws.evidencePath)
    assert.deepEqual(
      evidence.all().map((record) => record.type),
      ['request', 'authority', 'execution_attempt', 'target_ack', 'outcome'],
    )
    assert.equal(verifyEvidenceRecords(evidence.all()), result.evidenceHead)
  } finally {
    await ws.cleanup()
  }
})

test('gate 5: expired authority blocks execution without touching the target', async () => {
  const ws = await workspace()
  try {
    const target = await IdempotentTargetFixture.open(ws.targetPath)
    // The intent is still valid (until 12:05); only the authority has expired.
    const result = await run(ws, b2Adapter(target), {
      payload: { expiresAt: '2026-10-10T12:01:00.000Z' },
      now: new Date('2026-10-10T12:03:00.000Z'),
    })
    assert.equal(result.status, 'DENIED')
    assert.equal(result.reason, 'EXPIRED')
    assert.equal(target.mutationCount(), 0)
  } finally {
    await ws.cleanup()
  }
})

test('gate 7: a replayed nonce is rejected, including after a restart', async () => {
  const ws = await workspace()
  try {
    const target = await IdempotentTargetFixture.open(ws.targetPath)
    assert.equal((await run(ws, b2Adapter(target))).status, 'EXECUTED')
    // run() reopens the nonce journal from disk, so this is a fresh process view.
    const replay = await run(ws, b2Adapter(target))
    assert.equal(replay.status, 'DENIED')
    assert.equal(replay.reason, 'NONCE_REPLAYED')
    assert.equal(target.mutationCount(), 1)
  } finally {
    await ws.cleanup()
  }
})

test('gate 8: a B1 target rejects a stale writer generation', async () => {
  const ws = await workspace()
  try {
    const target = new FencedTargetFixture()
    const newer = await run(ws, b1Adapter(target), {
      intent: { intentId: 'intent-gen-5' },
      payload: { authorityId: 'authority-gen-5', nonce: 'nonce-generation-5-abcdef', fencingGeneration: 5 },
    })
    assert.equal(newer.status, 'EXECUTED')
    const stale = await run(ws, b1Adapter(target), {
      intent: { intentId: 'intent-gen-4' },
      payload: { authorityId: 'authority-gen-4', nonce: 'nonce-generation-4-abcdef', fencingGeneration: 4 },
    })
    assert.equal(stale.status, 'DENIED')
    assert.equal(stale.reason, 'STALE_GENERATION')
    assert.equal(target.mutationCount(), 1)

    const missing = await run(ws, b1Adapter(target), {
      intent: { intentId: 'intent-no-gen' },
      payload: { authorityId: 'authority-no-gen', nonce: 'nonce-no-generation-abcdef' },
    })
    assert.equal(missing.reason, 'FENCING_GENERATION_REQUIRED')
  } finally {
    await ws.cleanup()
  }
})

test('gate 9: a B2 duplicate produces one mutation and a deterministic receipt, across restarts', async () => {
  const ws = await workspace()
  try {
    const first = await run(ws, b2Adapter(await IdempotentTargetFixture.open(ws.targetPath)))
    assert.equal(first.status, 'EXECUTED')

    // Deliberate retries against a restarted target see the durable commit.
    const retryA = await run(ws, b2Adapter(await IdempotentTargetFixture.open(ws.targetPath)), { retry: true })
    const retryB = await run(ws, b2Adapter(await IdempotentTargetFixture.open(ws.targetPath)), { retry: true })
    assert.equal(retryA.status, 'DUPLICATE')
    assert.equal(retryA.receipt?.receiptHash, retryB.receipt?.receiptHash)
    assert.equal(retryA.receipt?.mutationSequence, first.receipt?.mutationSequence)
    assert.equal((await IdempotentTargetFixture.open(ws.targetPath)).mutationCount(), 1)
  } finally {
    await ws.cleanup()
  }
})

test('gate 10: a Class C target cannot execute autonomously during a partition', async () => {
  const ws = await workspace()
  try {
    let mutations = 0
    const classC: TargetAdapter = {
      id: 'batch-scheduler',
      targetClass: 'C',
      execute: async ({ idempotencyKey }) => {
        mutations += 1
        return { targetClass: 'C', outcome: 'APPLIED', key: idempotencyKey, mutationSequence: mutations, receiptHash: 'c' }
      },
    }
    const partitioned = await run(ws, classC, { connectivity: 'PARTITIONED', human: true })
    assert.equal(partitioned.reason, 'CLASS_C_REQUIRES_CONFIRMED_CONNECTIVITY')
    const unattended = await run(ws, classC, { connectivity: 'CONFIRMED', human: false })
    assert.equal(unattended.reason, 'CLASS_C_REQUIRES_CURRENT_HUMAN_AUTHORIZATION')
    assert.equal(mutations, 0)

    const attended = await run(ws, classC, { connectivity: 'CONFIRMED', human: true })
    assert.equal(attended.status, 'EXECUTED')
    assert.equal(mutations, 1)
  } finally {
    await ws.cleanup()
  }
})

test('an ambiguous target response is UNKNOWN and is never blindly retried', async () => {
  const ws = await workspace()
  try {
    let calls = 0
    const flaky: TargetAdapter = {
      id: 'batch-scheduler',
      targetClass: 'B2',
      execute: async () => {
        calls += 1
        throw new Error('connection reset after send')
      },
    }
    const unknown = await run(ws, flaky)
    assert.equal(unknown.status, 'UNKNOWN')
    const blind = await run(ws, flaky)
    assert.equal(blind.reason, 'NONCE_REPLAYED')
    assert.equal(calls, 1)
  } finally {
    await ws.cleanup()
  }
})

test('two signatures: a second authority for an already-executed intent cannot run it again', async () => {
  const ws = await workspace()
  try {
    const target = await IdempotentTargetFixture.open(ws.targetPath)
    assert.equal((await run(ws, b2Adapter(target))).status, 'EXECUTED')
    const reissued = await run(ws, b2Adapter(target), {
      payload: { authorityId: 'authority-reissued', nonce: 'nonce-reissued-0123456789' },
    })
    assert.equal(reissued.status, 'DENIED')
    assert.equal(reissued.reason, 'INTENT_REPLAYED')
    assert.equal(target.mutationCount(), 1)
  } finally {
    await ws.cleanup()
  }
})

test('compare-and-set: a change applies only if the target state is what the requester saw', async () => {
  const ws = await workspace()
  try {
    const target = await IdempotentTargetFixture.open(ws.targetPath)
    const first = await run(ws, b2Adapter(target), {
      intent: { intentId: 'intent-cas-a', expectedGeneration: 0, expectedPreStateRoot: GENESIS_STATE_ROOT },
      payload: { authorityId: 'authority-cas-a', nonce: 'nonce-cas-a-0123456789' },
    })
    assert.equal(first.status, 'EXECUTED')
    assert.equal(first.receipt?.generation, 1)

    // Another requester acted on the same stale view: rejected, nothing applied.
    const staleGeneration = await run(ws, b2Adapter(target), {
      intent: { intentId: 'intent-cas-b', expectedGeneration: 0, expectedPreStateRoot: GENESIS_STATE_ROOT },
      payload: { authorityId: 'authority-cas-b', nonce: 'nonce-cas-b-0123456789' },
    })
    assert.equal(staleGeneration.reason, 'GENERATION_MISMATCH')
    const staleRoot = await run(ws, b2Adapter(target), {
      intent: { intentId: 'intent-cas-c', expectedGeneration: 1, expectedPreStateRoot: GENESIS_STATE_ROOT },
      payload: { authorityId: 'authority-cas-c', nonce: 'nonce-cas-c-0123456789' },
    })
    assert.equal(staleRoot.reason, 'PRE_STATE_MISMATCH')
    assert.equal(target.mutationCount(), 1)

    // An intent built on the current state applies, and survives a restart.
    const current = (await IdempotentTargetFixture.open(ws.targetPath)).currentState()
    assert.equal(current.stateRoot, first.receipt?.postStateRoot)
    const fresh = await run(ws, b2Adapter(await IdempotentTargetFixture.open(ws.targetPath)), {
      intent: { intentId: 'intent-cas-d', expectedGeneration: current.generation, expectedPreStateRoot: current.stateRoot },
      payload: { authorityId: 'authority-cas-d', nonce: 'nonce-cas-d-0123456789' },
    })
    assert.equal(fresh.status, 'EXECUTED')
    assert.equal(fresh.receipt?.generation, 2)

    // A deliberate retry of the first intent is still a DUPLICATE, not a CAS failure.
    const retry = await run(ws, b2Adapter(await IdempotentTargetFixture.open(ws.targetPath)), {
      intent: { intentId: 'intent-cas-a', expectedGeneration: 0, expectedPreStateRoot: GENESIS_STATE_ROOT },
      payload: { authorityId: 'authority-cas-a', nonce: 'nonce-cas-a-0123456789' },
      retry: true,
    })
    assert.equal(retry.status, 'DUPLICATE')
    assert.equal((await IdempotentTargetFixture.open(ws.targetPath)).mutationCount(), 2)
  } finally {
    await ws.cleanup()
  }
})

test('compare-and-set: expectations a target cannot enforce are refused, not ignored', async () => {
  const ws = await workspace()
  try {
    const target = await IdempotentTargetFixture.open(ws.targetPath)
    const result = await run(ws, b2Adapter(target, false), {
      intent: { expectedGeneration: 0 },
    })
    assert.equal(result.status, 'DENIED')
    assert.equal(result.reason, 'CONDITIONAL_MUTATION_UNSUPPORTED')
    assert.equal(target.mutationCount(), 0)
  } finally {
    await ws.cleanup()
  }
})
