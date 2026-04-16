import { ZodError } from 'zod'

import { badRequest, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { parseRunRequestShape } from '@/modules/runs/contracts/public-run-request.schema'
import { PublicRunResponseSchema } from '@/modules/runs/contracts/public-run-response.schema'
import { mapInternalRunResultToPublicCandidate } from '@/modules/runs/mappers/map-internal-run-result-to-public'
import { mapPublicRunRequestToInternal, normalizeRunRequest } from '@/modules/runs/mappers/map-public-run-request-to-internal'
import { serializePublicRunResponse } from '@/modules/runs/exposure/serialize-public-run-response'
import { orchestrateGovernedRun } from '@/modules/runs/services/orchestrate-governed-run'
import { resolveExposureTier } from '@/modules/runs/services/resolve-exposure-tier'
import { resolveRunAuthContext } from '@/modules/runs/services/resolve-run-auth-context'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await resolveRunAuthContext(request, 'runs:write')
  if (!auth.ok) {
    return auth.response
  }

  let parsedBody: ReturnType<typeof parseRunRequestShape>
  try {
    parsedBody = parseRunRequestShape(await request.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return badRequest('Invalid run payload', error.flatten())
    }
    return badRequest('Invalid run payload')
  }

  try {
    if (auth.isInternalAdmin && !auth.organizationId) {
      return badRequest('x-organization-id header is required for platform admin writes')
    }

    const normalized = normalizeRunRequest(parsedBody)
    const projectId =
      auth.projectId ??
      normalized.value.metadata?.projectId ??
      (normalized.value.metadata?.projectSlug
        ? await resolveProjectIdBySlug(auth.organizationId, normalized.value.metadata.projectSlug)
        : undefined)

    if (!projectId) {
      return badRequest('Project scope is required for governed runs')
    }

    const internalRequest = mapPublicRunRequestToInternal(normalized.value, {
      organizationId: auth.organizationId,
      projectId,
      environmentSlug: normalized.value.environment,
    })

    const envelope = await orchestrateGovernedRun({
      actor: {
        id: auth.kind === 'api_key' ? auth.actorId : undefined,
        organizationId: auth.organizationId,
        projectId,
      },
      payload: internalRequest,
    })

    const tier = await resolveExposureTier({
      organizationId: auth.organizationId,
      isInternalAdmin: auth.isInternalAdmin,
    })

    const candidate = mapInternalRunResultToPublicCandidate(envelope)
    const serialized = serializePublicRunResponse(candidate, {
      tier,
      isInternalAdmin: auth.isInternalAdmin,
    })
    const response = PublicRunResponseSchema.parse(serialized)

    const headers = parsedBody.source === 'legacy'
      ? { 'x-ecobe-deprecated-request-shape': 'legacy' }
      : undefined

    return json(response, {
      status: response.status === 'completed' ? 201 : 200,
      headers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Run execution failed'
    const status =
      message.includes('requires tier_3') || message.includes('Billing account is canceled')
        ? 402
        : 500

    return json({ error: message }, { status })
  }
}

async function resolveProjectIdBySlug(organizationId: string, projectSlug: string) {
  const project = await prisma.project.findFirst({
    where: {
      organizationId,
      slug: projectSlug,
    },
    select: { id: true },
  })
  return project?.id
}
