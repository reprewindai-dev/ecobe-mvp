import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { CappoTargetAdapter } from '../src/lib/authority/adapters/cappo-adapter'

const BASE = process.env.CAPPO_LIVE_URL ?? 'http://127.0.0.1:8002'
const JWT_A = process.env.CAPPO_JWT_A ?? ''
const JWT_B = process.env.CAPPO_JWT_B ?? ''
const JWT_C = process.env.CAPPO_JWT_C ?? ''
const WS_A = process.env.CAPPO_WS_A ?? 'stress-ws-alpha'
const WS_B = process.env.CAPPO_WS_B ?? 'stress-ws-beta'
const WS_C = process.env.CAPPO_WS_C ?? 'stress-ws-gamma'

if (!JWT_A || !JWT_B || !JWT_C) {
  console.error('Missing CAPPO_JWT_A / CAPPO_JWT_B / CAPPO_JWT_C')
  process.exit(1)
}

interface WaveMetrics {
  wave: number
  name: string
  totalOperations: number
  cumulativeOperations: number
  authorizedCommitsExpected: number
  authorizedCommitsApplied: number
  adversarialAttempts: number
  adversarialBlocked: number
  handoversCompleted: number
  cumulativeVerifiedLineageDepth: number
  breachCount: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  opsPerSec: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Number(sorted[idx].toFixed(2))
}

async function main() {
  const runId = `goldcurve-${Date.now()}`
  const resourceA = `${runId}-alpha`
  const resourceB = `${runId}-beta`
  const resourceC = `${runId}-gamma`
  const hash = 'ab'.repeat(32)
  let seq = 0
  const nextKey = (prefix: string) => {
    seq += 1
    return `${prefix}_${seq}_${Date.now().toString(16)}`.padEnd(48, '0').slice(0, 64)
  }

  async function createMount(jwt: string, ws: string) {
    const t0 = performance.now()
    const res = await fetch(`${BASE}/v1/capability/mounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'X-Workspace-ID': ws,
      },
      body: JSON.stringify({
        package_ref: 'veklom.governed-counter@v1',
        execution_scope: { workspace: ws, project: 'sandbox' },
        requested_action_scope: { reads: [], writes: ['counter.increment'] },
        ttl_seconds: 600,
      }),
    })
    const dt = performance.now() - t0
    assert.equal(res.status, 200, `Mount failed with HTTP ${res.status}`)
    const body = (await res.json()) as {
      decision: string
      mount: { id: string; incarnation: number; authority_epoch: number; history_head: string }
      token: { token_id: string; nonce: string }
    }
    assert.equal(body.decision, 'allow')
    return {
      id: body.mount.id,
      tok: body.token,
      incarnation: body.mount.incarnation,
      epoch: body.mount.authority_epoch,
      historyHead: body.mount.history_head,
      latencyMs: dt,
    }
  }

  function makeAdapter(
    mountId: string,
    tok: { token_id: string; nonce: string },
    jwt: string,
    ws: string,
    resource: string,
  ) {
    return new CappoTargetAdapter({
      baseUrl: BASE,
      mountId,
      tokenId: tok.token_id,
      tokenNonce: tok.nonce,
      bearerToken: jwt,
      workspaceId: ws,
      targetRef: 'activation.governed-counter',
      action: 'counter.increment',
      resource,
    })
  }

  const waves: WaveMetrics[] = []
  let cumulativeOps = 0
  let cumulativeLineage = 0
  let deepMountId = ''
  let deepFinalHead = ''

  // =========================================================================
  // WAVE 1: 5-Hop D0->D3->D0 Continuity Chain + Zombie Predecessor Barrage
  // =========================================================================
  {
    const latencies: number[] = []
    const tStart = performance.now()
    let applied = 0
    let advAttempts = 0
    let advBlocked = 0
    let handovers = 0
    let breaches = 0

    const m = await createMount(JWT_A, WS_A)
    latencies.push(m.latencyMs)
    let currentAdapter = makeAdapter(m.id, m.tok, JWT_A, WS_A, resourceA)
    let currentHead = m.historyHead
    const predecessors: Array<{ adapter: CappoTargetAdapter; epoch: number }> = []

    for (let hop = 1; hop <= 5; hop++) {
      predecessors.push({ adapter: currentAdapter, epoch: hop })
      const t0 = performance.now()
      const h = await currentAdapter.handoverIncarnation({
        decisionHash: `dec_wave1_hop_${hop}`,
        reason: `d3_to_d0_hop_${hop}`,
      })
      latencies.push(performance.now() - t0)
      assert.equal(h.previousHistoryHead, currentHead, 'Broken continuity chain on Wave 1')
      assert.equal(h.incarnation, hop + 1)
      assert.equal(h.authorityEpoch, hop + 1)
      currentHead = h.historyHead
      currentAdapter = h.adapter
      handovers += 1
      cumulativeLineage += 1
    }

    // All 5 zombie predecessors attack both at their old epoch AND spoofing the new epoch (6)
    for (const pred of predecessors) {
      const t1 = performance.now()
      const rOld = await pred.adapter.execute({
        idempotencyKey: nextKey('w1_stale'),
        payloadHash: hash,
        fencingGeneration: pred.epoch,
      })
      latencies.push(performance.now() - t1)
      advAttempts += 1
      if (rOld.outcome === 'REJECTED' && rOld.reason === 'stale_authority_epoch') {
        advBlocked += 1
      } else {
        breaches += 1
      }

      const t2 = performance.now()
      const rSpoof = await pred.adapter.execute({
        idempotencyKey: nextKey('w1_spoof'),
        payloadHash: hash,
        fencingGeneration: 6,
      })
      latencies.push(performance.now() - t2)
      advAttempts += 1
      if (rSpoof.outcome === 'REJECTED' && rSpoof.reason === 'token_mismatch') {
        advBlocked += 1
      } else {
        breaches += 1
      }
    }

    // Active incarnation 6 commits once
    const tCommit = performance.now()
    const rCommit = await currentAdapter.execute({
      idempotencyKey: nextKey('w1_commit'),
      payloadHash: hash,
      fencingGeneration: 6,
    })
    latencies.push(performance.now() - tCommit)
    if (rCommit.outcome === 'APPLIED') applied += 1
    else breaches += 1
    cumulativeLineage += 1

    // 3 post-commit replay attempts
    for (let r = 0; r < 3; r++) {
      const tRep = performance.now()
      const resRep = await currentAdapter.execute({
        idempotencyKey: nextKey('w1_replay'),
        payloadHash: hash,
        fencingGeneration: 6,
      })
      latencies.push(performance.now() - tRep)
      advAttempts += 1
      if (resRep.outcome === 'REJECTED') advBlocked += 1
      else breaches += 1
    }

    const elapsedSec = (performance.now() - tStart) / 1000
    const sorted = [...latencies].sort((a, b) => a - b)
    cumulativeOps += latencies.length
    waves.push({
      wave: 1,
      name: '5-Hop Continuity Chain & Zombie Fencing',
      totalOperations: latencies.length,
      cumulativeOperations: cumulativeOps,
      authorizedCommitsExpected: 1,
      authorizedCommitsApplied: applied,
      adversarialAttempts: advAttempts,
      adversarialBlocked: advBlocked,
      handoversCompleted: handovers,
      cumulativeVerifiedLineageDepth: cumulativeLineage,
      breachCount: breaches,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      opsPerSec: Number((latencies.length / elapsedSec).toFixed(1)),
    })
  }

  // =========================================================================
  // WAVE 2: Multi-Tenant Isolation & Forgery Barrage (ws-alpha, ws-beta, ws-gamma)
  // =========================================================================
  {
    const latencies: number[] = []
    const tStart = performance.now()
    let applied = 0
    let advAttempts = 0
    let advBlocked = 0
    let handovers = 0
    let breaches = 0

    const tenants = [
      { jwt: JWT_A, ws: WS_A, res: resourceA, attackerJwt: JWT_B, attackerWs: WS_B },
      { jwt: JWT_B, ws: WS_B, res: resourceB, attackerJwt: JWT_C, attackerWs: WS_C },
      { jwt: JWT_C, ws: WS_C, res: resourceC, attackerJwt: JWT_A, attackerWs: WS_A },
    ]

    for (let i = 0; i < 9; i++) {
      const t = tenants[i % 3]
      const m = await createMount(t.jwt, t.ws)
      latencies.push(m.latencyMs)

      // 1. Cross-workspace attack from another tenant
      const tCross = performance.now()
      const crossAdapter = makeAdapter(m.id, m.tok, t.attackerJwt, t.attackerWs, t.res)
      const rCross = await crossAdapter.execute({
        idempotencyKey: nextKey('w2_cross'),
        payloadHash: hash,
        fencingGeneration: 1,
      })
      latencies.push(performance.now() - tCross)
      advAttempts += 1
      if (rCross.outcome === 'REJECTED' && rCross.reason === 'owner_mismatch') advBlocked += 1
      else breaches += 1

      // 2. Forged nonce attack
      const tForge = performance.now()
      const forgeAdapter = makeAdapter(
        m.id,
        { token_id: m.tok.token_id, nonce: 'forged_nonce_attack' },
        t.jwt,
        t.ws,
        t.res,
      )
      const rForge = await forgeAdapter.execute({
        idempotencyKey: nextKey('w2_forge'),
        payloadHash: hash,
        fencingGeneration: 1,
      })
      latencies.push(performance.now() - tForge)
      advAttempts += 1
      if (rForge.outcome === 'REJECTED' && rForge.reason === 'token_mismatch') advBlocked += 1
      else breaches += 1

      // 3. Handover + legitimate commit by true owner
      const ownerAdapter = makeAdapter(m.id, m.tok, t.jwt, t.ws, t.res)
      const tH = performance.now()
      const h = await ownerAdapter.handoverIncarnation({
        decisionHash: `dec_w2_${i}`,
        reason: 'tenant_handover',
      })
      latencies.push(performance.now() - tH)
      handovers += 1
      cumulativeLineage += 1

      const tValid = performance.now()
      const rValid = await h.adapter.execute({
        idempotencyKey: nextKey('w2_valid'),
        payloadHash: hash,
        fencingGeneration: 2,
      })
      latencies.push(performance.now() - tValid)
      if (rValid.outcome === 'APPLIED') {
        applied += 1
        cumulativeLineage += 1
      } else {
        breaches += 1
      }

      // 4. Replay after commit
      const tRep = performance.now()
      const rRep = await h.adapter.execute({
        idempotencyKey: nextKey('w2_rep'),
        payloadHash: hash,
        fencingGeneration: 2,
      })
      latencies.push(performance.now() - tRep)
      advAttempts += 1
      if (rRep.outcome === 'REJECTED') advBlocked += 1
      else breaches += 1
    }

    const elapsedSec = (performance.now() - tStart) / 1000
    const sorted = [...latencies].sort((a, b) => a - b)
    cumulativeOps += latencies.length
    waves.push({
      wave: 2,
      name: '3-Tenant Isolation & Forgery Barrage',
      totalOperations: latencies.length,
      cumulativeOperations: cumulativeOps,
      authorizedCommitsExpected: 9,
      authorizedCommitsApplied: applied,
      adversarialAttempts: advAttempts,
      adversarialBlocked: advBlocked,
      handoversCompleted: handovers,
      cumulativeVerifiedLineageDepth: cumulativeLineage,
      breachCount: breaches,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      opsPerSec: Number((latencies.length / elapsedSec).toFixed(1)),
    })
  }

  // =========================================================================
  // WAVE 3: Split-Brain Concurrency Storms (Same-Op + Distinct-Op + Omitted-Epoch)
  // =========================================================================
  {
    const latencies: number[] = []
    const tStart = performance.now()
    let applied = 0
    let advAttempts = 0
    let advBlocked = 0
    let handovers = 0
    let breaches = 0

    // Part A: 25-way parallel storm with SHARED idempotency key on one single-use mount
    const mSame = await createMount(JWT_A, WS_A)
    latencies.push(mSame.latencyMs)
    const sameAdapter = makeAdapter(mSame.id, mSame.tok, JWT_A, WS_A, resourceA)
    const sharedKey = nextKey('w3_same25')
    const sameRes = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const t0 = performance.now()
        const res = await sameAdapter.execute({
          idempotencyKey: sharedKey,
          payloadHash: hash,
          fencingGeneration: 1,
        })
        latencies.push(performance.now() - t0)
        return res
      }),
    )
    const sameApplied = sameRes.filter((r) => r.outcome === 'APPLIED').length
    const sameRejected = sameRes.filter((r) => r.outcome === 'REJECTED').length
    if (sameApplied === 1 && sameRejected === 24) {
      applied += 1
      advAttempts += 24
      advBlocked += 24
      cumulativeLineage += 1
    } else {
      breaches += Math.abs(sameApplied - 1) + 1
    }

    // Part B (Auditor Gap 2): 25-way parallel storm with DISTINCT operation IDs on one single-use mount
    const mDist = await createMount(JWT_A, WS_A)
    latencies.push(mDist.latencyMs)
    const distAdapter = makeAdapter(mDist.id, mDist.tok, JWT_A, WS_A, resourceA)
    const distRes = await Promise.all(
      Array.from({ length: 25 }, async (_, idx) => {
        const t0 = performance.now()
        const res = await distAdapter.execute({
          idempotencyKey: nextKey(`w3_dist25_${idx}`),
          payloadHash: hash,
          fencingGeneration: 1,
        })
        latencies.push(performance.now() - t0)
        return res
      }),
    )
    const distApplied = distRes.filter((r) => r.outcome === 'APPLIED').length
    const distRejected = distRes.filter((r) => r.outcome === 'REJECTED').length
    if (distApplied === 1 && distRejected === 24) {
      applied += 1
      advAttempts += 24
      advBlocked += 24
      cumulativeLineage += 1
    } else {
      breaches += Math.abs(distApplied - 1) + 1
    }

    // Part C (Auditor Gap 1): Bare /advance-epoch followed by execute OMITTING authority_epoch
    const mBare = await createMount(JWT_A, WS_A)
    latencies.push(mBare.latencyMs)
    const tAdv = performance.now()
    const advRes = await fetch(`${BASE}/v1/capability/mounts/${mBare.id}/advance-epoch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JWT_A}`,
        'Content-Type': 'application/json',
        'X-Workspace-ID': WS_A,
      },
    })
    latencies.push(performance.now() - tAdv)
    assert.equal(advRes.status, 200)
    const tOmit = performance.now()
    const omitRes = await fetch(`${BASE}/v1/capability/mounts/${mBare.id}/execute`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JWT_A}`,
        'Content-Type': 'application/json',
        'X-Workspace-ID': WS_A,
      },
      body: JSON.stringify({
        token_id: mBare.tok.token_id,
        nonce: mBare.tok.nonce,
        action: 'counter.increment',
        target_ref: 'activation.governed-counter',
        resource: resourceA,
        operation_id: nextKey('w3_omit_epoch'),
        arguments: { delta: 1 },
        // Intentionally omitting authority_epoch!
      }),
    })
    latencies.push(performance.now() - tOmit)
    const omitBody = (await omitRes.json()) as { decision: string; reason: string }
    advAttempts += 1
    if (omitRes.status === 200 && omitBody.decision === 'deny' && omitBody.reason === 'stale_authority_epoch') {
      advBlocked += 1
    } else {
      breaches += 1
    }

    // Part D: 5 mounts x (handover + 8 zombie predecessor races + 1 successor commit)
    for (let b = 0; b < 5; b++) {
      const mb = await createMount(JWT_A, WS_A)
      latencies.push(mb.latencyMs)
      const k1 = makeAdapter(mb.id, mb.tok, JWT_A, WS_A, resourceA)
      const th = performance.now()
      const h = await k1.handoverIncarnation({
        decisionHash: `dec_w3_race_${b}`,
        reason: 'split_brain_storm_test',
      })
      latencies.push(performance.now() - th)
      handovers += 1
      cumulativeLineage += 1

      // Fire 8 stale K1 calls + 1 valid K2 call in parallel
      const batchRes = await Promise.all([
        ...Array.from({ length: 8 }, async (_, idx) => {
          const t0 = performance.now()
          const r = await k1.execute({
            idempotencyKey: nextKey(`w3_k1_${b}_${idx}`),
            payloadHash: hash,
            fencingGeneration: 1,
          })
          latencies.push(performance.now() - t0)
          return { role: 'stale', r }
        }),
        (async () => {
          const t0 = performance.now()
          const r = await h.adapter.execute({
            idempotencyKey: nextKey(`w3_k2_${b}`),
            payloadHash: hash,
            fencingGeneration: 2,
          })
          latencies.push(performance.now() - t0)
          return { role: 'valid', r }
        })(),
      ])

      for (const item of batchRes) {
        if (item.role === 'valid') {
          if (item.r.outcome === 'APPLIED') {
            applied += 1
            cumulativeLineage += 1
          } else {
            breaches += 1
          }
        } else {
          advAttempts += 1
          if (item.r.outcome === 'REJECTED' && item.r.reason === 'stale_authority_epoch') {
            advBlocked += 1
          } else {
            breaches += 1
          }
        }
      }
    }

    const elapsedSec = (performance.now() - tStart) / 1000
    const sorted = [...latencies].sort((a, b) => a - b)
    cumulativeOps += latencies.length
    waves.push({
      wave: 3,
      name: 'Concurrency Storms (Same-Op, Distinct-Op, Omitted-Epoch & Handover Races)',
      totalOperations: latencies.length,
      cumulativeOperations: cumulativeOps,
      authorizedCommitsExpected: 7,
      authorizedCommitsApplied: applied,
      adversarialAttempts: advAttempts,
      adversarialBlocked: advBlocked,
      handoversCompleted: handovers,
      cumulativeVerifiedLineageDepth: cumulativeLineage,
      breachCount: breaches,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      opsPerSec: Number((latencies.length / elapsedSec).toFixed(1)),
    })
  }

  // =========================================================================
  // WAVE 4: Fault Injection (Target Rejections, Invalid Scopes, Mixed Load)
  // =========================================================================
  {
    const latencies: number[] = []
    const tStart = performance.now()
    let applied = 0
    let advAttempts = 0
    let advBlocked = 0
    let handovers = 0
    let breaches = 0

    for (let i = 0; i < 12; i++) {
      const m = await createMount(JWT_A, WS_A)
      latencies.push(m.latencyMs)

      // Inject a target-side ValueError (delta = 0) via /v1/capability/mounts/{id}/execute
      // Verify it returns HTTP 200 decision=deny target_rejected:invalid_counter_delta (never HTTP 500!)
      const tFault = performance.now()
      const faultRes = await fetch(`${BASE}/v1/capability/mounts/${m.id}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${JWT_A}`,
          'Content-Type': 'application/json',
          'X-Workspace-ID': WS_A,
        },
        body: JSON.stringify({
          token_id: m.tok.token_id,
          nonce: m.tok.nonce,
          action: 'counter.increment',
          target_ref: 'activation.governed-counter',
          resource: resourceA,
          authority_epoch: 1,
          operation_id: nextKey(`w4_fault_${i}`),
          arguments: { delta: 0 },
        }),
      })
      latencies.push(performance.now() - tFault)
      advAttempts += 1
      const faultBody = (await faultRes.json()) as { decision: string; reason: string }
      if (
        faultRes.status === 200 &&
        faultBody.decision === 'deny' &&
        faultBody.reason?.startsWith('target_rejected:')
      ) {
        advBlocked += 1
      } else {
        breaches += 1
      }

      // Now mount a clean capability, handover twice, and commit once
      const mClean = await createMount(JWT_A, WS_A)
      latencies.push(mClean.latencyMs)
      const a1 = makeAdapter(mClean.id, mClean.tok, JWT_A, WS_A, resourceA)
      const th1 = performance.now()
      const h1 = await a1.handoverIncarnation({
        decisionHash: `dec_w4_${i}_1`,
        reason: 'post_fault_handover_1',
      })
      latencies.push(performance.now() - th1)
      handovers += 1
      cumulativeLineage += 1

      const th2 = performance.now()
      const h2 = await h1.adapter.handoverIncarnation({
        decisionHash: `dec_w4_${i}_2`,
        reason: 'post_fault_handover_2',
      })
      latencies.push(performance.now() - th2)
      handovers += 1
      cumulativeLineage += 1

      // Stale h1 tries to execute at epoch 2 -> fenced
      const tStale = performance.now()
      const rStale = await h1.adapter.execute({
        idempotencyKey: nextKey(`w4_stale_${i}`),
        payloadHash: hash,
        fencingGeneration: 2,
      })
      latencies.push(performance.now() - tStale)
      advAttempts += 1
      if (rStale.outcome === 'REJECTED' && rStale.reason === 'stale_authority_epoch') {
        advBlocked += 1
      } else {
        breaches += 1
      }

      // Current h2 executes at epoch 3 -> APPLIED
      const tOk = performance.now()
      const rOk = await h2.adapter.execute({
        idempotencyKey: nextKey(`w4_ok_${i}`),
        payloadHash: hash,
        fencingGeneration: 3,
      })
      latencies.push(performance.now() - tOk)
      if (rOk.outcome === 'APPLIED') {
        applied += 1
        cumulativeLineage += 1
      } else {
        breaches += 1
      }
    }

    const elapsedSec = (performance.now() - tStart) / 1000
    const sorted = [...latencies].sort((a, b) => a - b)
    cumulativeOps += latencies.length
    waves.push({
      wave: 4,
      name: 'Target Fault Injection & Post-Fault Continuity Recovery',
      totalOperations: latencies.length,
      cumulativeOperations: cumulativeOps,
      authorizedCommitsExpected: 12,
      authorizedCommitsApplied: applied,
      adversarialAttempts: advAttempts,
      adversarialBlocked: advBlocked,
      handoversCompleted: handovers,
      cumulativeVerifiedLineageDepth: cumulativeLineage,
      breachCount: breaches,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      opsPerSec: Number((latencies.length / elapsedSec).toFixed(1)),
    })
  }

  // =========================================================================
  // WAVE 5: 25-Incarnation Deep Continuity Soak + 120 Adversarial Probes
  // =========================================================================
  {
    const latencies: number[] = []
    const tStart = performance.now()
    let applied = 0
    let advAttempts = 0
    let advBlocked = 0
    let handovers = 0
    let breaches = 0

    const mDeep = await createMount(JWT_A, WS_A)
    latencies.push(mDeep.latencyMs)
    deepMountId = mDeep.id
    let currAdapter = makeAdapter(mDeep.id, mDeep.tok, JWT_A, WS_A, resourceA)
    let currHead = mDeep.historyHead

    for (let inc = 1; inc < 25; inc++) {
      const prevAdapter = currAdapter
      const tH = performance.now()
      const h = await currAdapter.handoverIncarnation({
        decisionHash: `dec_deep_inc_${inc + 1}`,
        reason: `deep_soak_transition_${inc}_to_${inc + 1}`,
      })
      latencies.push(performance.now() - tH)
      assert.equal(h.previousHistoryHead, currHead, `Lineage break at incarnation ${inc + 1}`)
      assert.equal(h.incarnation, inc + 1)
      assert.equal(h.authorityEpoch, inc + 1)
      currHead = h.historyHead
      currAdapter = h.adapter
      handovers += 1
      cumulativeLineage += 1

      // At every single incarnation transition, fire 5 adversarial probes:
      // 1) Predecessor at old epoch -> stale_authority_epoch
      // 2) Predecessor spoofing new epoch -> token_mismatch
      // 3) Cross-tenant B -> owner_mismatch
      // 4) Cross-tenant C -> owner_mismatch
      // 5) Forged nonce at current epoch -> token_mismatch
      const probes = await Promise.all([
        (async () => {
          const t0 = performance.now()
          const r = await prevAdapter.execute({
            idempotencyKey: nextKey(`w5_stale_${inc}`),
            payloadHash: hash,
            fencingGeneration: inc,
          })
          latencies.push(performance.now() - t0)
          return r.outcome === 'REJECTED' && r.reason === 'stale_authority_epoch'
        })(),
        (async () => {
          const t0 = performance.now()
          const r = await prevAdapter.execute({
            idempotencyKey: nextKey(`w5_spoof_${inc}`),
            payloadHash: hash,
            fencingGeneration: inc + 1,
          })
          latencies.push(performance.now() - t0)
          return r.outcome === 'REJECTED' && r.reason === 'token_mismatch'
        })(),
        (async () => {
          const t0 = performance.now()
          const r = await makeAdapter(mDeep.id, mDeep.tok, JWT_B, WS_B, resourceA).execute({
            idempotencyKey: nextKey(`w5_xb_${inc}`),
            payloadHash: hash,
            fencingGeneration: inc + 1,
          })
          latencies.push(performance.now() - t0)
          return r.outcome === 'REJECTED' && r.reason === 'owner_mismatch'
        })(),
        (async () => {
          const t0 = performance.now()
          const r = await makeAdapter(mDeep.id, mDeep.tok, JWT_C, WS_C, resourceA).execute({
            idempotencyKey: nextKey(`w5_xc_${inc}`),
            payloadHash: hash,
            fencingGeneration: inc + 1,
          })
          latencies.push(performance.now() - t0)
          return r.outcome === 'REJECTED' && r.reason === 'owner_mismatch'
        })(),
        (async () => {
          const t0 = performance.now()
          const r = await makeAdapter(
            mDeep.id,
            { token_id: mDeep.tok.token_id, nonce: `forged_${inc}` },
            JWT_A,
            WS_A,
            resourceA,
          ).execute({
            idempotencyKey: nextKey(`w5_fn_${inc}`),
            payloadHash: hash,
            fencingGeneration: inc + 1,
          })
          latencies.push(performance.now() - t0)
          return r.outcome === 'REJECTED' && r.reason === 'token_mismatch'
        })(),
      ])

      for (const ok of probes) {
        advAttempts += 1
        if (ok) advBlocked += 1
        else breaches += 1
      }
    }

    deepFinalHead = currHead

    // Final commit at Incarnation 25, Epoch 25
    const tFinal = performance.now()
    const rFinal = await currAdapter.execute({
      idempotencyKey: nextKey('w5_final_25'),
      payloadHash: hash,
      fencingGeneration: 25,
    })
    latencies.push(performance.now() - tFinal)
    if (rFinal.outcome === 'APPLIED') {
      applied += 1
      cumulativeLineage += 1
    } else {
      breaches += 1
    }

    const elapsedSec = (performance.now() - tStart) / 1000
    const sorted = [...latencies].sort((a, b) => a - b)
    cumulativeOps += latencies.length
    waves.push({
      wave: 5,
      name: '25-Incarnation Deep Lineage Soak & 120-Probe Barrage',
      totalOperations: latencies.length,
      cumulativeOperations: cumulativeOps,
      authorizedCommitsExpected: 1,
      authorizedCommitsApplied: applied,
      adversarialAttempts: advAttempts,
      adversarialBlocked: advBlocked,
      handoversCompleted: handovers,
      cumulativeVerifiedLineageDepth: cumulativeLineage,
      breachCount: breaches,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      opsPerSec: Number((latencies.length / elapsedSec).toFixed(1)),
    })
  }

  console.log(
    JSON.stringify(
      {
        runId,
        resources: {
          alpha: { workspace: WS_A, resource: resourceA, expectedCounter: 24 },
          beta: { workspace: WS_B, resource: resourceB, expectedCounter: 3 },
          gamma: { workspace: WS_C, resource: resourceC, expectedCounter: 3 },
        },
        deepMount: {
          mountId: deepMountId,
          expectedIncarnation: 25,
          expectedEpoch: 25,
          finalHistoryHead: deepFinalHead,
        },
        waves,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
