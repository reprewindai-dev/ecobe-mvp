import { z } from 'zod'

import { canonicalHash, canonicalJsonBytes } from '@/lib/authority/canonical'

// One canonical audit record per CO2 Router decision, rendered for machines
// (canonical JSON) and for people (Markdown). The Markdown is a deterministic
// view of the JSON and carries its hash, so the two can never disagree.

export const AUDIT_RECORD_SCHEMA = 'co2router.audit-record.v1'

export class AuditRecordInvalidError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuditRecordInvalidError'
  }
}

export class AuditRecordMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditRecordMismatchError'
  }
}

// The subset of the engine's /ci/authorize response the record reads.
const DecisionResponseSchema = z.object({
  decisionFrameId: z.string().min(1),
  decision: z.enum(['run_now', 'reroute', 'delay', 'throttle', 'deny']),
  reasonCode: z.string().min(1),
  selectedRegion: z.string().min(1),
  signalMode: z.string().optional(),
  fallbackUsed: z.boolean().optional(),
  signalConfidence: z.number().optional(),
  doctrineVersion: z.string().optional(),
  proofEnvelope: z.object({ proofHash: z.string().min(1) }),
  baseline: z.object({ region: z.string().min(1), carbonIntensity: z.number().nonnegative() }),
  workflowOutputs: z.object({ carbonIntensity: z.number().nonnegative() }).optional(),
  decisionEnvelope: z
    .object({ timing: z.object({ notBefore: z.string().nullable().optional() }).optional() })
    .optional(),
  mss: z.object({ carbonProvider: z.string().optional() }).optional(),
  candidateEvaluations: z
    .array(
      z.object({
        region: z.string().min(1),
        carbonIntensity: z.number().nonnegative(),
        guardrailCandidateBlocked: z.boolean(),
        guardrailReasons: z.array(z.string()),
        waterEvidence: z.string().optional(),
        carbonSourceUsed: z.string().optional(),
        carbonFallbackUsed: z.boolean().optional(),
      }),
    )
    .default([]),
})

export type IneligibleReason =
  | 'FALLBACK_SIGNALS'
  | 'ENERGY_NOT_PROVIDED'
  | 'DELAYED_EXECUTION_REQUIRES_REALIZED_INTENSITY'
  | 'THROTTLED_EXECUTION'
  | 'NO_EXECUTION'

export type AuditRecord = {
  schema: typeof AUDIT_RECORD_SCHEMA
  decisionFrameId: string
  proofHash: string
  recordedAt: string
  decision: {
    action: string
    reasonCode: string
    selectedRegion: string
    baselineRegion: string
    notBefore: string | null
    doctrineVersion: string | null
  }
  signals: {
    mode: string | null
    fallbackUsed: boolean
    confidence: number | null
    carbonProvider: string | null
  }
  candidates: Array<{
    region: string
    carbonIntensityGPerKwh: number
    blocked: boolean
    reasons: string[]
    waterEvidence: string | null
    // Per-candidate carbon provenance; null when the engine did not report it,
    // so a placeholder value is never presented as a measurement.
    carbonSource: string | null
    carbonFallbackUsed: boolean | null
  }>
  // Software Carbon Intensity (ISO/IEC 21031:2024) operational component O = E x I.
  // Embodied emissions (M) and the functional unit (R) are out of scope here.
  sci: {
    method: 'SCI_OPERATIONAL_E_X_I'
    accounting: 'location_based_grid_intensity_at_decision_time'
    energyKwh: number | null
    baselineIntensityGPerKwh: number
    selectedIntensityGPerKwh: number
    baselineOperationalG: number | null
    selectedOperationalG: number | null
    avoidedOperationalG: number | null
    embodiedIncluded: false
    eligibleAsMeasured: boolean
    ineligibleReason: IneligibleReason | null
  }
}

export type AuditRecordContext = {
  recordedAt: Date
  // Workload energy estimate supplied by the caller; never inferred here.
  estimatedEnergyKwh?: number
}

function ineligibleReasonFor(
  action: string,
  fallbackUsed: boolean,
  signalMode: string | null,
  energyKwh: number | null,
): IneligibleReason | null {
  if (fallbackUsed || signalMode === 'fallback') return 'FALLBACK_SIGNALS'
  if (energyKwh === null) return 'ENERGY_NOT_PROVIDED'
  if (action === 'deny') return 'NO_EXECUTION'
  if (action === 'throttle') return 'THROTTLED_EXECUTION'
  // A delay is decided on forecasts; only intensity observed when the job
  // actually ran can support a measured figure.
  if (action === 'delay') return 'DELAYED_EXECUTION_REQUIRES_REALIZED_INTENSITY'
  return null
}

export function buildAuditRecord(decisionResponse: unknown, context: AuditRecordContext): AuditRecord {
  const parsed = DecisionResponseSchema.safeParse(decisionResponse)
  if (!parsed.success) {
    throw new AuditRecordInvalidError('Decision response is missing fields the audit record requires', {
      cause: parsed.error,
    })
  }
  const d = parsed.data
  const energy = context.estimatedEnergyKwh
  if (energy !== undefined && (!Number.isFinite(energy) || energy < 0)) {
    throw new AuditRecordInvalidError('estimatedEnergyKwh must be a non-negative finite number')
  }
  const energyKwh = energy ?? null
  const fallbackUsed = d.fallbackUsed ?? false
  const signalMode = d.signalMode ?? null
  const baselineIntensity = d.baseline.carbonIntensity
  const selectedIntensity = d.workflowOutputs?.carbonIntensity ?? baselineIntensity
  const operational = (intensity: number) => (energyKwh === null ? null : energyKwh * intensity)
  const ineligibleReason = ineligibleReasonFor(d.decision, fallbackUsed, signalMode, energyKwh)
  const baselineOperationalG = operational(baselineIntensity)
  const selectedOperationalG = operational(selectedIntensity)

  return {
    schema: AUDIT_RECORD_SCHEMA,
    decisionFrameId: d.decisionFrameId,
    proofHash: d.proofEnvelope.proofHash,
    recordedAt: context.recordedAt.toISOString(),
    decision: {
      action: d.decision,
      reasonCode: d.reasonCode,
      selectedRegion: d.selectedRegion,
      baselineRegion: d.baseline.region,
      notBefore: d.decisionEnvelope?.timing?.notBefore ?? null,
      doctrineVersion: d.doctrineVersion ?? null,
    },
    signals: {
      mode: signalMode,
      fallbackUsed,
      confidence: d.signalConfidence ?? null,
      carbonProvider: d.mss?.carbonProvider ?? null,
    },
    candidates: d.candidateEvaluations.map((candidate) => ({
      region: candidate.region,
      carbonIntensityGPerKwh: candidate.carbonIntensity,
      blocked: candidate.guardrailCandidateBlocked,
      reasons: candidate.guardrailReasons,
      waterEvidence: candidate.waterEvidence ?? null,
      carbonSource: candidate.carbonSourceUsed ?? null,
      carbonFallbackUsed: candidate.carbonFallbackUsed ?? null,
    })),
    sci: {
      method: 'SCI_OPERATIONAL_E_X_I',
      accounting: 'location_based_grid_intensity_at_decision_time',
      energyKwh,
      baselineIntensityGPerKwh: baselineIntensity,
      selectedIntensityGPerKwh: selectedIntensity,
      baselineOperationalG,
      selectedOperationalG,
      avoidedOperationalG:
        ineligibleReason === null && baselineOperationalG !== null && selectedOperationalG !== null
          ? baselineOperationalG - selectedOperationalG
          : null,
      embodiedIncluded: false,
      eligibleAsMeasured: ineligibleReason === null,
      ineligibleReason,
    },
  }
}

export function auditRecordJson(record: AuditRecord): string {
  return canonicalJsonBytes(record).toString('utf8')
}

export function auditRecordHash(record: AuditRecord): string {
  return canonicalHash(record)
}

const show = (value: string | number | boolean | null) => (value === null ? 'not available' : String(value))

// Deterministic human view of the record: same data, no interpretation added.
export function renderAuditMarkdown(record: AuditRecord): string {
  const { decision, signals, sci } = record
  const lines = [
    `# CO2 Router decision audit record`,
    ``,
    `Record SHA-256: \`${auditRecordHash(record)}\` (schema \`${record.schema}\`)`,
    `This page is generated from the machine record with that hash. Regenerate it to verify.`,
    ``,
    `## Decision`,
    `- Decision frame: \`${record.decisionFrameId}\``,
    `- Engine proof hash: \`${record.proofHash}\``,
    `- Recorded at: ${record.recordedAt}`,
    `- Action: **${decision.action}** (${decision.reasonCode})`,
    `- Selected region: ${decision.selectedRegion}; baseline region: ${decision.baselineRegion}`,
    `- Not before: ${show(decision.notBefore)}`,
    `- Doctrine: ${show(decision.doctrineVersion)}`,
    ``,
    `## Signals`,
    `- Mode: ${show(signals.mode)}; fallback used: ${signals.fallbackUsed ? 'yes' : 'no'}`,
    `- Confidence: ${show(signals.confidence)}`,
    `- Carbon provider (as labeled by the engine): ${show(signals.carbonProvider)}`,
    ``,
    `## Candidates`,
    `| Region | Carbon (gCO2/kWh) | Carbon source | Blocked | Reasons | Water evidence |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...record.candidates.map((c) => {
      const source =
        c.carbonSource === null
          ? 'not reported by engine'
          : `${c.carbonSource}${c.carbonFallbackUsed ? ' (fallback)' : ''}`
      return `| ${c.region} | ${c.carbonIntensityGPerKwh} | ${source} | ${c.blocked ? 'yes' : 'no'} | ${c.reasons.join(', ') || 'none'} | ${show(c.waterEvidence)} |`
    }),
    ``,
    `## Carbon (SCI operational component, E × I)`,
    `- Accounting: location-based grid intensity at decision time; embodied emissions not included`,
    `- Energy: ${sci.energyKwh === null ? 'not provided' : `${sci.energyKwh} kWh`}`,
    `- Baseline: ${sci.baselineIntensityGPerKwh} gCO2/kWh -> ${show(sci.baselineOperationalG)} g`,
    `- Selected: ${sci.selectedIntensityGPerKwh} gCO2/kWh -> ${show(sci.selectedOperationalG)} g`,
    `- Avoided: ${show(sci.avoidedOperationalG)} g`,
    `- Eligible as measured: ${sci.eligibleAsMeasured ? 'yes' : `no (${sci.ineligibleReason})`}`,
    ``,
  ]
  return lines.join('\n')
}

export type AuditPair = { json: string; markdown: string; hash: string }

export function renderAuditPair(record: AuditRecord): AuditPair {
  return { json: auditRecordJson(record), markdown: renderAuditMarkdown(record), hash: auditRecordHash(record) }
}

// Verifies that a human page and a machine record describe the same decision:
// the page must be exactly what the JSON renders to, hash included.
export function verifyAuditPair(pair: { json: string; markdown: string }): AuditRecord {
  let record: AuditRecord
  try {
    record = JSON.parse(pair.json) as AuditRecord
  } catch (error) {
    throw new AuditRecordInvalidError('Machine record is not valid JSON', { cause: error })
  }
  if (record.schema !== AUDIT_RECORD_SCHEMA) {
    throw new AuditRecordInvalidError(`Unsupported audit record schema: ${String(record.schema)}`)
  }
  if (auditRecordJson(record) !== pair.json) {
    throw new AuditRecordMismatchError('Machine record is not in canonical form')
  }
  if (renderAuditMarkdown(record) !== pair.markdown) {
    throw new AuditRecordMismatchError('Human page does not match the machine record')
  }
  return record
}
