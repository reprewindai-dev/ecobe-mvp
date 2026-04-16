import { prisma } from '@/lib/prisma'
import type { ExposureTier } from '@/modules/runs/exposure/exposure-tier.types'

export async function resolveExposureTier(input: {
  organizationId: string
  isInternalAdmin?: boolean
}): Promise<ExposureTier> {
  if (input.isInternalAdmin) {
    return 'internal'
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: {
      planTier: true,
      billingAccount: {
        select: {
          subscriptions: {
            where: {
              status: {
                in: ['active', 'past_due'],
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { planTier: true },
          },
        },
      },
    },
  })

  const tier = organization?.billingAccount?.subscriptions[0]?.planTier ?? organization?.planTier ?? 'tier_2'

  if (tier === 'tier_1') return 'free'
  if (tier === 'tier_3') return 'elite'
  return 'pro'
}
