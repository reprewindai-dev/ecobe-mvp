import { z } from 'zod'

import { requireAdmin, generateApiKey, generateServiceAccountKey } from '@/lib/auth'
import { badRequest, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { ensureTenantScope } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationName: z.string().min(1),
  organizationSlug: z.string().min(1),
  projectName: z.string().min(1),
  projectSlug: z.string().min(1),
  environmentSlug: z.string().default('production'),
  keyName: z.string().default('Primary Production Key'),
  policyName: z.string().default('Default Governance Policy'),
  rules: z.record(z.any()).default({
    strictMode: true,
    requireApprovalThreshold: 45,
    blockThreshold: 75,
  }),
})

export async function POST(request: Request) {
  const admin = await requireAdmin(request)
  if (!admin.ok) {
    return admin.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid bootstrap payload', parsed.error.flatten())
  }

  const { organization, project } = await ensureTenantScope(parsed.data)

  const environment = await prisma.environment.upsert({
    where: {
      projectId_slug: {
        projectId: project.id,
        slug: parsed.data.environmentSlug,
      },
    },
    update: { name: parsed.data.environmentSlug },
    create: {
      projectId: project.id,
      name: parsed.data.environmentSlug,
      slug: parsed.data.environmentSlug,
    },
  })

  const generated = generateApiKey()
  const serviceAccountCredential = generateServiceAccountKey()
  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: organization.id,
      projectId: project.id,
      name: parsed.data.keyName,
      prefix: generated.prefix,
      keyHash: generated.hash,
      scopes: ['runs:write', 'runs:read', 'usage:read'],
    },
  })

  const serviceAccount = await prisma.serviceAccount.create({
    data: {
      organizationId: organization.id,
      name: `${parsed.data.organizationName} Automation`,
      prefix: serviceAccountCredential.prefix,
      secretHash: serviceAccountCredential.hash,
      scopes: [
        'dashboard:read',
        'keys:read',
        'keys:write',
        'policies:read',
        'policies:write',
        'webhooks:read',
        'webhooks:write',
      ],
    },
  })

  const policyProfile = await prisma.policyProfile.create({
    data: {
      organizationId: organization.id,
      projectId: project.id,
      name: parsed.data.policyName,
    },
  })

  const policyVersion = await prisma.policyVersion.create({
    data: {
      policyProfileId: policyProfile.id,
      version: 1,
      isActive: true,
      rules: parsed.data.rules as any,
    },
  })

  await prisma.billingAccount.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      status: 'active',
    },
  })

  return json({
    organizationId: organization.id,
    projectId: project.id,
    environmentId: environment.id,
    policyVersionId: policyVersion.id,
    apiKeyId: apiKey.id,
    apiKey: generated.plaintext,
    serviceAccountId: serviceAccount.id,
    serviceAccountKey: serviceAccountCredential.plaintext,
  }, { status: 201 })
}
