import { authenticateApiKey, authenticateServiceAccount, requireAdmin } from '@/lib/auth'
import { forbidden, unauthorized } from '@/lib/http'
import { prisma } from '@/lib/prisma'

type RequiredRunScope = 'runs:read' | 'runs:write'

type RunAuthSuccess = {
  ok: true
  kind: 'api_key' | 'service_account' | 'platform_admin'
  actorId: string
  organizationId: string
  projectId?: string
  isInternalAdmin: boolean
}

type RunAuthFailure = {
  ok: false
  response: Response
}

export type RunAuthContext = RunAuthSuccess | RunAuthFailure

export async function resolveRunAuthContext(request: Request, requiredScope: RequiredRunScope): Promise<RunAuthContext> {
  const admin = await requireAdmin(request)
  if (admin.ok) {
    const organizationId = request.headers.get('x-organization-id') ?? ''

    const projectId = await resolveProjectFromHeaders({
      organizationId,
      projectId: request.headers.get('x-project-id'),
      projectSlug: request.headers.get('x-project-slug'),
    })

    return {
      ok: true,
      kind: 'platform_admin',
      actorId: 'platform-admin',
      organizationId,
      projectId,
      isInternalAdmin: true,
    }
  }

  const apiKey = await authenticateApiKey(request)
  if (apiKey) {
    const scopes = arrayOfStrings(apiKey.scopes)
    if (!scopes.includes(requiredScope)) {
      return { ok: false, response: forbidden() }
    }

    return {
      ok: true,
      kind: 'api_key',
      actorId: apiKey.id,
      organizationId: apiKey.organizationId,
      projectId: apiKey.projectId ?? undefined,
      isInternalAdmin: false,
    }
  }

  const serviceAccount = await authenticateServiceAccount(request)
  if (serviceAccount) {
    const scopes = arrayOfStrings(serviceAccount.scopes)
    if (!scopes.includes(requiredScope)) {
      return { ok: false, response: forbidden() }
    }

    const projectId = await resolveProjectFromHeaders({
      organizationId: serviceAccount.organizationId,
      projectId: request.headers.get('x-project-id'),
      projectSlug: request.headers.get('x-project-slug'),
    })

    return {
      ok: true,
      kind: 'service_account',
      actorId: serviceAccount.id,
      organizationId: serviceAccount.organizationId,
      projectId,
      isInternalAdmin: false,
    }
  }

  return { ok: false, response: unauthorized() }
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

async function resolveProjectFromHeaders(input: {
  organizationId: string
  projectId: string | null
  projectSlug: string | null
}): Promise<string | undefined> {
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: input.projectId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    })
    return project?.id
  }

  if (input.projectSlug) {
    const project = await prisma.project.findFirst({
      where: {
        slug: input.projectSlug,
        organizationId: input.organizationId,
      },
      select: { id: true },
    })
    return project?.id
  }

  const projects = await prisma.project.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: 2,
  })

  if (projects.length === 1) {
    return projects[0].id
  }

  return undefined
}
