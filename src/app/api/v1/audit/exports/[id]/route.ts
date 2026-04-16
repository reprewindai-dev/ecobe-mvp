import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { forbidden, json, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { resolveExposureTier } from '@/modules/runs/services/resolve-exposure-tier'
import { sanitizeAuditExportRecord } from '@/modules/runs/services/sanitize-audit-export'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(request, ['audit:read'])
  if (!access.ok) {
    return access.response
  }

  const { id } = await context.params
  const auditExport = await prisma.auditExport.findUnique({
    where: { id },
  })

  if (!auditExport) {
    return notFound('Audit export not found')
  }

  if (!assertOrganizationAccess(access, auditExport.organizationId)) {
    return forbidden()
  }

  const tier = await resolveExposureTier({
    organizationId: auditExport.organizationId,
    isInternalAdmin: access.isPlatformAdmin,
  })
  const response = sanitizeAuditExportRecord(auditExport, {
    tier,
    isInternalAdmin: access.isPlatformAdmin,
  })

  return json(response)
}
