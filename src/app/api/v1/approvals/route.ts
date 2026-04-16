import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { PublicRunResponseSchema } from '@/modules/runs/contracts/public-run-response.schema'
import { mapInternalRunResultToPublicCandidate, mapRunRecordToInternalEnvelope } from '@/modules/runs/mappers/map-internal-run-result-to-public'
import { serializePublicRunResponse } from '@/modules/runs/exposure/serialize-public-run-response'
import { resolveExposureTier } from '@/modules/runs/services/resolve-exposure-tier'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['approvals:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')
  const status = url.searchParams.get('status') ?? undefined

  const organization = organizationSlug
    ? await prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true },
      })
    : null

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  if (!access.isPlatformAdmin && !organization) {
    return badRequest('organizationSlug is required for scoped access')
  }

  const approvals = await prisma.approvalRequest.findMany({
    where: {
      ...(organization ? { organizationId: organization.id } : access.isPlatformAdmin ? {} : { organizationId: access.organizationId }),
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      run: true,
    },
  })

  const tierCache = new Map<string, Awaited<ReturnType<typeof resolveExposureTier>>>()
  const data = await Promise.all(
    approvals.map(async (approval) => {
      if (!approval.run) {
        return approval
      }

      let tier = tierCache.get(approval.organizationId)
      if (!tier) {
        tier = await resolveExposureTier({
          organizationId: approval.organizationId,
          isInternalAdmin: access.isPlatformAdmin,
        })
        tierCache.set(approval.organizationId, tier)
      }

      const serializedRun = PublicRunResponseSchema.parse(
        serializePublicRunResponse(
          mapInternalRunResultToPublicCandidate(mapRunRecordToInternalEnvelope(approval.run)),
          {
            tier,
            isInternalAdmin: access.isPlatformAdmin,
          }
        )
      )

      return {
        ...approval,
        run: serializedRun,
      }
    })
  )

  return json({ data })
}
