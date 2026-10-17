import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AuditRecordInvalidError,
  AuditRecordMismatchError,
  buildAuditRecord,
  renderAuditPair,
  verifyAuditPair,
} from '@/lib/audit-record/audit-record'

// Fields copied verbatim from a decision captured from the production engine on 2026-03-31.
const production = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'production-decision-2026-03-31.json'), 'utf8'),
) as Record<string, unknown>

const recordedAt = new Date('2026-03-31T00:22:52.682Z')

function liveReroute(overrides: Record<string, unknown> = {}) {
  return {
    ...production,
    decision: 'reroute',
    selectedRegion: 'eu-west-3',
    baseline: { region: 'eu-west-2', carbonIntensity: 69 },
    workflowOutputs: { carbonIntensity: 18 },
    ...overrides,
  }
}

test('builds a record from a real production decision without inventing savings', () => {
  const record = buildAuditRecord(production, { recordedAt, estimatedEnergyKwh: 10 })
  assert.equal(record.decisionFrameId, '9e663658-ce6a-4bd5-a81e-c481eeffdee8')
  assert.equal(record.proofHash, 'c6aec8e8faf8f7a49054376adfcfbb8338c8175191e7f72dba3229cb8bfa62b5')
  assert.equal(record.signals.carbonProvider, 'REDIS_CACHE_WATTTIME_MOER')
  assert.equal(record.sci.baselineOperationalG, 290)
  assert.equal(record.sci.selectedOperationalG, 290)
  assert.equal(record.sci.avoidedOperationalG, 0)
  assert.equal(record.sci.eligibleAsMeasured, true)
})

test('the human page and the machine record verify as the same decision', () => {
  const pair = renderAuditPair(buildAuditRecord(liveReroute(), { recordedAt, estimatedEnergyKwh: 10 }))
  assert.match(pair.markdown, new RegExp(pair.hash))
  const verified = verifyAuditPair(pair)
  assert.equal(verified.sci.avoidedOperationalG, 510)
})

test('editing either format is detected', () => {
  const pair = renderAuditPair(buildAuditRecord(liveReroute(), { recordedAt, estimatedEnergyKwh: 10 }))
  assert.throws(
    () => verifyAuditPair({ ...pair, markdown: pair.markdown.replace('Avoided: 510 g', 'Avoided: 900 g') }),
    AuditRecordMismatchError,
  )
  const forgedJson = pair.json.replace('"avoidedOperationalG":510', '"avoidedOperationalG":900')
  assert.notEqual(forgedJson, pair.json)
  assert.throws(() => verifyAuditPair({ json: forgedJson, markdown: pair.markdown }), AuditRecordMismatchError)
  assert.throws(() => verifyAuditPair({ json: '{not json', markdown: pair.markdown }), AuditRecordInvalidError)
})

test('decisions that cannot support a measured figure are labeled, never counted', () => {
  const cases: Array<[Record<string, unknown>, number | undefined, string]> = [
    [liveReroute({ fallbackUsed: true }), 10, 'FALLBACK_SIGNALS'],
    [liveReroute({ signalMode: 'fallback' }), 10, 'FALLBACK_SIGNALS'],
    [liveReroute(), undefined, 'ENERGY_NOT_PROVIDED'],
    [liveReroute({ decision: 'delay' }), 10, 'DELAYED_EXECUTION_REQUIRES_REALIZED_INTENSITY'],
    [liveReroute({ decision: 'throttle' }), 10, 'THROTTLED_EXECUTION'],
    [liveReroute({ decision: 'deny' }), 10, 'NO_EXECUTION'],
  ]
  for (const [decision, energy, reason] of cases) {
    const record = buildAuditRecord(decision, { recordedAt, estimatedEnergyKwh: energy })
    assert.equal(record.sci.eligibleAsMeasured, false, reason)
    assert.equal(record.sci.ineligibleReason, reason)
    assert.equal(record.sci.avoidedOperationalG, null, reason)
  }
})

test('the same decision always produces byte-identical records', () => {
  const a = renderAuditPair(buildAuditRecord(liveReroute(), { recordedAt, estimatedEnergyKwh: 10 }))
  const b = renderAuditPair(buildAuditRecord(liveReroute(), { recordedAt, estimatedEnergyKwh: 10 }))
  assert.deepEqual(a, b)
})

test('rejects decision responses missing required fields or with invalid energy', () => {
  const { proofEnvelope: _omitted, ...withoutProof } = production
  assert.throws(() => buildAuditRecord(withoutProof, { recordedAt }), AuditRecordInvalidError)
  assert.throws(
    () => buildAuditRecord(production, { recordedAt, estimatedEnergyKwh: -1 }),
    AuditRecordInvalidError,
  )
})

test('candidate carbon values without engine provenance are labeled as unreported', () => {
  const record = buildAuditRecord(production, { recordedAt, estimatedEnergyKwh: 10 })
  assert.ok(record.candidates.every((c) => c.carbonSource === null && c.carbonFallbackUsed === null))
  const { markdown } = renderAuditPair(record)
  assert.match(markdown, /\| eu-west-1 \| 400 \| not reported by engine \|/)

  const labeled = buildAuditRecord(
    {
      ...production,
      candidateEvaluations: [
        { region: 'eu-west-1', carbonIntensity: 400, guardrailCandidateBlocked: false, guardrailReasons: [], carbonSourceUsed: 'STATIC_FALLBACK', carbonFallbackUsed: true },
      ],
    },
    { recordedAt, estimatedEnergyKwh: 10 },
  )
  assert.match(renderAuditPair(labeled).markdown, /\| eu-west-1 \| 400 \| STATIC_FALLBACK \(fallback\) \|/)
})
