import type { PublicRunEvent } from '@/modules/runs/contracts/public-run.types'
import type { ExposureContext } from '@/modules/runs/exposure/exposure-tier.types'
import { NEVER_PUBLIC_FIELDS, resolveAllowedPathsByTier } from '@/modules/runs/exposure/public-run-field-policy'
import { omitDeep } from '@/modules/runs/utils/omit-deep'
import { pickDeep } from '@/modules/runs/utils/pick-deep'
import { pruneUndefinedDeep } from '@/modules/runs/utils/prune-undefined-deep'

type UnknownRecord = Record<string, unknown>

export function serializePublicRunEvents(rawEvents: Array<PublicRunEvent & UnknownRecord>, ctx: ExposureContext): PublicRunEvent[] {
  const effectiveTier = ctx.tier === 'internal' && ctx.isInternalAdmin ? 'internal' : ctx.tier
  const allowedPaths = resolveAllowedPathsByTier(effectiveTier)

  return rawEvents.map((event) => {
    const stripped = effectiveTier === 'internal' ? event : omitDeep(event, NEVER_PUBLIC_FIELDS)
    const projected = pickDeep(stripped as UnknownRecord, allowedPaths)
    const cleaned = pruneUndefinedDeep(projected) ?? {}
    return cleaned as PublicRunEvent
  })
}
