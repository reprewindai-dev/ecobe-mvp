import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { serializeRunExportRows } from '@/modules/runs/exposure/serialize-run-export'
import { resolveExposureTier } from '@/modules/runs/services/resolve-exposure-tier'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['webhooks:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')

  if (!organizationSlug && !access.isPlatformAdmin) {
    return badRequest('organizationSlug is required for scoped access')
  }

  const organization = organizationSlug
    ? await prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true },
      })
    : null

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const deliveries = await prisma.webhookDelivery.findMany({
    where: access.isPlatformAdmin
      ? organization
        ? { organizationId: organization.id, provider: 'customer_webhook' }
        : { provider: 'customer_webhook' }
      : {
          organizationId: access.organizationId,
          provider: 'customer_webhook',
        },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      webhookEndpointId: true,
      providerEventId: true,
      eventType: true,
      status: true,
      responseCode: true,
      responseBody: true,
      processedAt: true,
      createdAt: true,
    },
  })

  if (access.isPlatformAdmin && !organization) {
    return json({ data: deliveries })
  }

  const organizationId = organization?.id ?? access.organizationId ?? ''
  if (!organizationId) {
    return badRequest('organizationSlug is required for platform admin filtering')
  }
  const tier = await resolveExposureTier({
    organizationId,
    isInternalAdmin: access.isPlatformAdmin,
  })

  const data = deliveries.map((entry) => ({
    ...entry,
    responseBody: serializeRunExportRows(entry.responseBody, {
      tier,
      isInternalAdmin: access.isPlatformAdmin,
    }),
  }))

  return json({ data })
}
