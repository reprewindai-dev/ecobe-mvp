import { prisma } from './prisma'

export async function ensureTenantScope(input: {
  organizationName: string
  organizationSlug: string
  projectName: string
  projectSlug: string
}) {
  const organization = await prisma.organization.upsert({
    where: { slug: input.organizationSlug },
    update: { name: input.organizationName },
    create: { name: input.organizationName, slug: input.organizationSlug },
  })

  const project = await prisma.project.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: input.projectSlug,
      },
    },
    update: { name: input.projectName },
    create: {
      organizationId: organization.id,
      name: input.projectName,
      slug: input.projectSlug,
    },
  })

  return { organization, project }
}
