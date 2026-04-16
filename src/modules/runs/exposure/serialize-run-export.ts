import type { ExposureContext } from '@/modules/runs/exposure/exposure-tier.types'
import { NEVER_PUBLIC_FIELDS } from '@/modules/runs/exposure/public-run-field-policy'
import { omitDeep } from '@/modules/runs/utils/omit-deep'
import { mapInternalRunEventToPublicCandidate } from '@/modules/runs/mappers/map-internal-run-event-to-public'
import { mapInternalRunResultToPublicCandidate } from '@/modules/runs/mappers/map-internal-run-result-to-public'
import { serializePublicRunEvents } from '@/modules/runs/exposure/serialize-public-run-events'
import { serializePublicRunResponse } from '@/modules/runs/exposure/serialize-public-run-response'

type UnknownRecord = Record<string, unknown>

export function serializeRunExportRows<T>(rows: T, ctx: ExposureContext): T {
  const effectiveTier = ctx.tier === 'internal' && ctx.isInternalAdmin ? 'internal' : ctx.tier
  if (effectiveTier === 'internal') {
    return rows
  }
  return deepSanitize(rows, { tier: effectiveTier, isInternalAdmin: false }) as T
}

function deepSanitize(value: unknown, ctx: ExposureContext): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepSanitize(entry, ctx))
  }

  if (looksLikeRunRecord(value)) {
    return serializePublicRunResponse(
      mapInternalRunResultToPublicCandidate(value),
      ctx
    )
  }

  if (looksLikeRunEventRecord(value)) {
    const [event] = serializePublicRunEvents(
      [mapInternalRunEventToPublicCandidate(normalizeRunEventRecord(value))],
      ctx
    )
    return event
  }

  if (!isRecord(value)) {
    return value
  }

  const stripped = omitDeep(value, NEVER_PUBLIC_FIELDS) as UnknownRecord
  const output: UnknownRecord = {}
  for (const [key, entry] of Object.entries(stripped)) {
    if (key === 'internal') {
      continue
    }
    output[key] = deepSanitize(entry, ctx)
  }
  return output
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function looksLikeRunRecord(value: unknown) {
  if (!isRecord(value)) return false
  return 'resultEnvelope' in value || 'inputPayload' in value || ('runId' in value && 'status' in value)
}

function looksLikeRunEventRecord(value: unknown) {
  if (!isRecord(value)) return false
  return ('eventType' in value && 'payload' in value) || ('type' in value && 'runId' in value && 'createdAt' in value)
}

function normalizeRunEventRecord(value: unknown) {
  const record = isRecord(value) ? value : {}
  const createdAtRaw = record.createdAt
  const createdAt = createdAtRaw instanceof Date
    ? createdAtRaw
    : new Date(typeof createdAtRaw === 'string' ? createdAtRaw : Date.now())

  return {
    id: typeof record.id === 'string' ? record.id : 'unknown_event',
    runId: typeof record.runId === 'string' ? record.runId : 'unknown_run',
    eventType:
      typeof record.eventType === 'string'
        ? record.eventType
        : typeof record.type === 'string'
          ? record.type
          : 'run.event',
    payload: isRecord(record.payload) ? record.payload : record.payload ?? {},
    signature: typeof record.signature === 'string' ? record.signature : '',
    createdAt,
  }
}
