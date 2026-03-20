import { z } from 'zod'

import { assertOrganizationAccess, hashSecret, requireScopedAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, json } from '@/lib/http'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationSlug: z.string().min(1),
  url: z.string().url(),
  secret: z.string().min(12),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['webhooks:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid webhook payload', parsed.error.flatten())
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.organizationSlug },
  })

  if (!organization) {
    return badRequest('Organization not found')
  }
  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const webhook = await prisma.webhookEndpoint.create({
    data: {
      organizationId: organization.id,
      url: parsed.data.url,
      secretHash: hashSecret(parsed.data.secret),
    },
  })

  return json({ id: webhook.id }, { status: 201 })
}

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['webhooks:read'])
  if (!access.ok) {
    return access.response
  }

  const organizationSlug = new URL(request.url).searchParams.get('organizationSlug')
  const organization =
    organizationSlug
      ? await prisma.organization.findUnique({
          where: { slug: organizationSlug },
          select: { id: true },
        })
      : null

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const webhooks = await prisma.webhookEndpoint.findMany({
    where: access.isPlatformAdmin
      ? (organizationSlug ? { organization: { slug: organizationSlug } } : undefined)
      : { organizationId: access.organizationId },
    orderBy: { createdAt: 'desc' },
  })

  return json({ data: webhooks })
}
