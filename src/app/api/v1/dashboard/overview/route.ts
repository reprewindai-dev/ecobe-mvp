import { requireScopedAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { json } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['dashboard:read'])
  if (!access.ok) {
    return access.response
  }

  const organizationWhere = access.isPlatformAdmin ? undefined : { organizationId: access.organizationId }

  const [organizations, runs, policies, usage] = await Promise.all([
    prisma.organization.count({
      where: access.isPlatformAdmin ? undefined : { id: access.organizationId },
    }),
    prisma.run.count({ where: organizationWhere }),
    prisma.policyVersion.count({
      where: {
        isActive: true,
        ...(access.isPlatformAdmin ? {} : { policyProfile: { organizationId: access.organizationId } }),
      },
    }),
    prisma.usageRecord.aggregate({
      where: organizationWhere,
      _sum: { amountUsd: true },
    }),
  ])

  return json({
    organizations,
    runs,
    activePolicies: policies,
    estimatedRevenue: usage._sum.amountUsd ?? 0,
  })
}
