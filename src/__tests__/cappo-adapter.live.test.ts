import assert from 'node:assert/strict'
import test from 'node:test'

import { CappoTargetAdapter } from '@/lib/authority/adapters/cappo-adapter'

const BASE = process.env.CAPPO_LIVE_URL ?? 'http://127.0.0.1:8002'
const JWT_A = process.env.CAPPO_JWT_A ?? process.env.CAPPO_JWT
const WS_A = process.env.CAPPO_WS_A ?? process.env.CAPPO_WS ?? 'adapter-rt-ws-a'
const JWT_B = process.env.CAPPO_JWT_B
const WS_B = process.env.CAPPO_WS_B ?? 'adapter-rt-ws-b'

test(
  'CappoTargetAdapter Live Integration: D0->D3->D0 handover, stale fencing, cross-owner, replay, and 20-way concurrency storm',
  { skip: !JWT_A ? 'Set CAPPO_JWT_A (and optionally CAPPO_JWT_B) to run unmocked live CAPPO tests' : false },
  async () => {
    const headersA = {
      Authorization: `Bearer ${JWT_A}`,
      'Content-Type': 'application/json',
      'X-Workspace-ID': WS_A,
    }
    const resource = `co2router-live-${Date.now()}`
    const runHex = Date.now().toString(16).padStart(16, '0')
    const key = (prefix: string) => (prefix + runHex + '0'.repeat(64)).slice(0, 64)
    const hash = 'cd'.repeat(32)

    async function mountInA() {
      const res = await fetch(`${BASE}/v1/capability/mounts`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          package_ref: 'veklom.governed-counter@v1',
          execution_scope: { workspace: WS_A, project: 'sandbox' },
          requested_action_scope: { reads: [], writes: ['counter.increment'] },
          ttl_seconds: 300,
        }),
      })
      assert.equal(res.status, 200, `mount HTTP ${res.status}`)
      const json = (await res.json()) as {
        decision: string
        mount: { id: string }
        token: { token_id: string; nonce: string }
      }
      assert.equal(json.decision, 'allow')
      return { id: json.mount.id, tok: json.token }
    }

    const makeAdapter = (
      id: string,
      tok: { token_id: string; nonce: string },
      jwt = JWT_A!,
      ws = WS_A,
    ) =>
      new CappoTargetAdapter({
        baseUrl: BASE,
        mountId: id,
        tokenId: tok.token_id,
        tokenNonce: tok.nonce,
        bearerToken: jwt,
        workspaceId: ws,
        targetRef: 'activation.governed-counter',
        action: 'counter.increment',
        resource,
      })

    // 1. Atomic Continuity Handover (D0 -> D3 -> D0):
    // Mount Incarnation 1 (K1, epoch 1), perform handover to Incarnation 2 (K2, epoch 2),
    // verify K1 is deterministically fenced with stale_authority_epoch, and K2 succeeds!
    const mHandover = await mountInA()
    const adapterK1 = makeAdapter(mHandover.id, mHandover.tok)
    const handoverReceipt = await adapterK1.handoverIncarnation({
      decisionHash: 'dec_brighton_clean_window_001',
      reason: 'd3_to_d0_clean_grid_wake',
    })
    assert.equal(handoverReceipt.incarnation, 2)
    assert.equal(handoverReceipt.previousAuthorityEpoch, 1)
    assert.equal(handoverReceipt.authorityEpoch, 2)
    assert.equal(handoverReceipt.previousHistoryHead.length, 64)
    assert.equal(handoverReceipt.historyHead.length, 64)
    assert.notEqual(handoverReceipt.historyHead, handoverReceipt.previousHistoryHead)

    // Predecessor K1 tries to execute at generation 1 -> FENCED (stale_authority_epoch)
    const rK1Stale = await adapterK1.execute({
      idempotencyKey: key('k1stale'),
      payloadHash: hash,
      fencingGeneration: 1,
    })
    assert.equal(rK1Stale.outcome, 'REJECTED')
    assert.equal(rK1Stale.reason, 'stale_authority_epoch')

    // Successor K2 executes at generation 2 -> APPLIED (counter becomes 1)
    const rK2Allow = await handoverReceipt.adapter.execute({
      idempotencyKey: key('k2allow'),
      payloadHash: hash,
      fencingGeneration: 2,
    })
    assert.equal(rK2Allow.outcome, 'APPLIED')

    // Replay of K2's consumed permit -> REJECTED
    const rK2Replay = await handoverReceipt.adapter.execute({
      idempotencyKey: key('k2allow'),
      payloadHash: hash,
      fencingGeneration: 2,
    })
    assert.equal(rK2Replay.outcome, 'REJECTED')

    // 2. Cross-owner / Cross-workspace & Tampered Nonce Isolation
    const mIso = await mountInA()
    if (JWT_B) {
      const rCrossOwner = await makeAdapter(mIso.id, mIso.tok, JWT_B, WS_B).execute({
        idempotencyKey: key('crossowner'),
        payloadHash: hash,
        fencingGeneration: 1,
      })
      assert.equal(rCrossOwner.outcome, 'REJECTED')
      assert.equal(rCrossOwner.reason, 'owner_mismatch')
    }

    const rBadNonce = await makeAdapter(mIso.id, {
      token_id: mIso.tok.token_id,
      nonce: 'forged-nonce-value',
    }).execute({
      idempotencyKey: key('badnonce'),
      payloadHash: hash,
      fencingGeneration: 1,
    })
    assert.equal(rBadNonce.outcome, 'REJECTED')
    assert.equal(rBadNonce.reason, 'token_mismatch')

    // 3. 20-Way Concurrent Storm on a single live mount -> Exactly 1 APPLIED, 19 REJECTED
    const mStorm = await mountInA()
    const stormAdapter = makeAdapter(mStorm.id, mStorm.tok)
    const stormKey = key('storm20')
    const stormResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        stormAdapter.execute({
          idempotencyKey: stormKey,
          payloadHash: hash,
          fencingGeneration: 1,
        }),
      ),
    )
    const applied = stormResults.filter((r) => r.outcome === 'APPLIED')
    const rejected = stormResults.filter((r) => r.outcome === 'REJECTED')
    assert.equal(applied.length, 1, `Expected exactly 1 APPLIED in 20-way storm, got ${applied.length}`)
    assert.equal(rejected.length, 19, `Expected 19 REJECTED in 20-way storm, got ${rejected.length}`)

    // 4. Bare advance-epoch refuses stale holder even when authority_epoch is omitted
    const mBare = await mountInA()
    const advRes = await fetch(`${BASE}/v1/capability/mounts/${mBare.id}/advance-epoch`, {
      method: 'POST',
      headers: headersA,
    })
    assert.equal(advRes.status, 200)
    const omitRes = await fetch(`${BASE}/v1/capability/mounts/${mBare.id}/execute`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        token_id: mBare.tok.token_id,
        nonce: mBare.tok.nonce,
        action: 'counter.increment',
        target_ref: 'activation.governed-counter',
        resource,
        operation_id: key('omitepoch'),
        arguments: { delta: 1 },
      }),
    })
    assert.equal(omitRes.status, 200)
    const omitBody = (await omitRes.json()) as { decision: string; reason: string }
    assert.equal(omitBody.decision, 'deny')
    assert.equal(omitBody.reason, 'stale_authority_epoch')

    // 5. 20-Way Distinct-Operation Storm on a single-use mount -> Exactly 1 APPLIED, 19 REJECTED
    const mDist = await mountInA()
    const distAdapter = makeAdapter(mDist.id, mDist.tok)
    const distResults = await Promise.all(
      Array.from({ length: 20 }, (_, idx) =>
        distAdapter.execute({
          idempotencyKey: key(`dist20_${idx}_`),
          payloadHash: hash,
          fencingGeneration: 1,
        }),
      ),
    )
    const distApplied = distResults.filter((r) => r.outcome === 'APPLIED')
    const distRejected = distResults.filter((r) => r.outcome === 'REJECTED')
    assert.equal(distApplied.length, 1, `Expected 1 APPLIED in 20-way distinct storm, got ${distApplied.length}`)
    assert.equal(distRejected.length, 19, `Expected 19 REJECTED in 20-way distinct storm, got ${distRejected.length}`)

    if (process.env.CAPPO_PRINT_RESOURCE === '1') {
      console.log(JSON.stringify({ resource, workspace: WS_A, handoverHistoryHead: handoverReceipt.historyHead }))
    }
  },
)
