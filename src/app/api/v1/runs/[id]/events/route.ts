import { json, notFound } from '@/lib/http'
import { PublicRunEventSchema } from '@/modules/runs/contracts/public-run-response.schema'
import { mapInternalRunEventToPublicCandidate } from '@/modules/runs/mappers/map-internal-run-event-to-public'
import { serializePublicRunEvents } from '@/modules/runs/exposure/serialize-public-run-events'
import { getGovernedRunById, getGovernedRunEvents } from '@/modules/runs/services/orchestrate-governed-run'
import { resolveExposureTier } from '@/modules/runs/services/resolve-exposure-tier'
import { resolveRunAuthContext } from '@/modules/runs/services/resolve-run-auth-context'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await resolveRunAuthContext(request, 'runs:read')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  const run = await getGovernedRunById({
    id,
    organizationId: auth.isInternalAdmin ? undefined : auth.organizationId,
  })

  if (!run) {
    return notFound('Run not found')
  }

  const tier = await resolveExposureTier({
    organizationId: run.organizationId,
    isInternalAdmin: auth.isInternalAdmin,
  })

  const events = await getGovernedRunEvents({
    runId: id,
    organizationId: auth.isInternalAdmin ? undefined : auth.organizationId,
  })

  const mapped = events.map((event) => mapInternalRunEventToPublicCandidate(event))
  const serialized = serializePublicRunEvents(mapped, {
    tier,
    isInternalAdmin: auth.isInternalAdmin,
  }).map((event) => PublicRunEventSchema.parse(event))

  return json({ data: serialized })
}
