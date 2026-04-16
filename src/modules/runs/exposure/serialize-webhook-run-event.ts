import type { PublicRunEvent } from '@/modules/runs/contracts/public-run.types'
import type { ExposureContext } from '@/modules/runs/exposure/exposure-tier.types'
import { serializePublicRunEvents } from '@/modules/runs/exposure/serialize-public-run-events'

type UnknownRecord = Record<string, unknown>

export function serializeWebhookRunEvent(
  event: PublicRunEvent & UnknownRecord,
  ctx: ExposureContext
): PublicRunEvent {
  const [serialized] = serializePublicRunEvents([event], ctx)
  return serialized
}
