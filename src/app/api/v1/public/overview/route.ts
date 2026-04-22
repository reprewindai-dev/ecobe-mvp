import { prisma } from '@/lib/prisma'
import { json } from '@/lib/http'
import { getEngineHealth } from '@/lib/engine'
import { getSekedHealth } from '@/lib/seked'
import { getConvergeosHealth } from '@/lib/convergeos'
import { governanceFallbackAllowed } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  let database = false

  try {
    await prisma.$queryRaw`SELECT 1`
    database = true
  } catch {
    database = false
  }

  const [
    engine,
    seked,
    convergeos,
    organizations,
    runs,
    policies,
    usage,
    pendingApprovals,
    openAlerts,
    auditExports,
    complianceReports,
    billingAccounts,
    activeBillingAccounts,
  ] = await Promise.all([
    getEngineHealth(),
    getSekedHealth(),
    getConvergeosHealth(),
    prisma.organization.count(),
    prisma.run.count(),
    prisma.policyVersion.count({ where: { isActive: true } }),
    prisma.usageRecord.aggregate({ _sum: { amountUsd: true } }),
    prisma.approvalRequest.count({ where: { status: 'pending' } }),
    prisma.alert.count(),
    prisma.auditExport.count(),
    prisma.complianceReport.count(),
    prisma.billingAccount.count(),
    prisma.billingAccount.count({ where: { status: 'active' } }),
  ])

  const ready =
    database &&
    ['healthy', 'not_configured'].includes(engine.status) &&
    (seked.status === 'healthy' ||
      (seked.status === 'not_configured' && governanceFallbackAllowed())) &&
    (convergeos.status === 'healthy' ||
      (convergeos.status === 'not_configured' && governanceFallbackAllowed()))

  return json(
    {
      status: ready ? 'ready' : 'degraded',
      checks: {
        database,
        engine,
        seked,
        convergeos,
      },
      metrics: {
        organizations,
        runs,
        activePolicies: policies,
        pendingApprovals,
        openAlerts,
        auditExports,
        complianceReports,
        billingAccounts,
        activeBillingAccounts,
        estimatedRevenue: usage._sum.amountUsd ?? 0,
      },
      signals: {
        replayAvailable: runs > 0,
        auditTrailAvailable: auditExports > 0,
        billingLive: activeBillingAccounts > 0,
      },
    },
    { status: ready ? 200 : 503 },
  )
}
