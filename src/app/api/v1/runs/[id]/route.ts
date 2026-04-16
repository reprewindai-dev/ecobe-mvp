import { json, notFound } from '@/lib/http'
import { PublicRunResponseSchema } from '@/modules/runs/contracts/public-run-response.schema'
import { mapInternalRunResultToPublicCandidate, mapRunRecordToInternalEnvelope } from '@/modules/runs/mappers/map-internal-run-result-to-public'
import { serializePublicRunResponse } from '@/modules/runs/exposure/serialize-public-run-response'
import { getGovernedRunById } from '@/modules/runs/services/orchestrate-governed-run'
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
  const candidate = mapInternalRunResultToPublicCandidate(mapRunRecordToInternalEnvelope(run))
  const serialized = serializePublicRunResponse(candidate, {
    tier,
    isInternalAdmin: auth.isInternalAdmin,
  })
  const response = PublicRunResponseSchema.parse(serialized)

  return json(response)
}
