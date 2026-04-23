import { prisma } from '@/lib/prisma'
import { getEngineHealth } from '@/lib/engine'
import { getSekedHealth } from '@/lib/seked'
import { getConvergeosHealth } from '@/lib/convergeos'
import { governanceFallbackAllowed } from '@/lib/env'

export type PublicOverview = {
  status: 'ready' | 'degraded'
  checks: {
    database: boolean
    engine: { status: string; error?: string }
    seked: { status: string; error?: string }
    convergeos: { status: string; error?: string }
  }
  metrics: {
    organizations: number
    runs: number
    activePolicies: number
    pendingApprovals: number
    openAlerts: number
    auditExports: number
    complianceReports: number
    billingAccounts: number
    activeBillingAccounts: number
    estimatedRevenue: number
  }
  signals: {
    replayAvailable: boolean
    auditTrailAvailable: boolean
    billingLive: boolean
  }
}

type RevenueResult = { _sum: { amountUsd: number | null } }

type CachedOverview = {
  value: PublicOverview
  expiresAt: number
  staleAt: number
}

const OVERVIEW_CACHE_TTL_MS = 15_000
const OVERVIEW_CACHE_STALE_MS = 45_000

let cachedOverview: CachedOverview | null = null
let refreshPromise: Promise<PublicOverview> | null = null

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback
}

async function computePublicOverview(): Promise<PublicOverview> {
  const [
    databaseResult,
    engineResult,
    sekedResult,
    convergeosResult,
    organizationsResult,
    runsResult,
    policiesResult,
    usageResult,
    pendingApprovalsResult,
    openAlertsResult,
    auditExportsResult,
    complianceReportsResult,
    billingAccountsResult,
    activeBillingAccountsResult,
  ] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
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

  const database = databaseResult.status === 'fulfilled'

  const organizations = toCount(settledValue(organizationsResult, 0))
  const runs = toCount(settledValue(runsResult, 0))
  const activePolicies = toCount(settledValue(policiesResult, 0))
  const pendingApprovals = toCount(settledValue(pendingApprovalsResult, 0))
  const openAlerts = toCount(settledValue(openAlertsResult, 0))
  const auditExports = toCount(settledValue(auditExportsResult, 0))
  const complianceReports = toCount(settledValue(complianceReportsResult, 0))
  const billingAccounts = toCount(settledValue(billingAccountsResult, 0))
  const activeBillingAccounts = toCount(settledValue(activeBillingAccountsResult, 0))
  const usage = settledValue<RevenueResult>(usageResult, { _sum: { amountUsd: null } })

  const engine = settledValue(engineResult, { status: 'unreachable', error: 'engine probe unavailable' })
  const seked = settledValue(sekedResult, { status: 'unreachable', error: 'seked probe unavailable' })
  const convergeos = settledValue(convergeosResult, { status: 'unreachable', error: 'convergeos probe unavailable' })

  const ready =
    database &&
    ['healthy', 'not_configured'].includes(engine.status) &&
    (seked.status === 'healthy' ||
      (seked.status === 'not_configured' && governanceFallbackAllowed())) &&
    (convergeos.status === 'healthy' ||
      (convergeos.status === 'not_configured' && governanceFallbackAllowed()))

  return {
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
      activePolicies,
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
  }
}

export async function buildPublicOverview(options?: { forceRefresh?: boolean }): Promise<PublicOverview> {
  const now = Date.now()
  const forceRefresh = options?.forceRefresh ?? false

  if (!forceRefresh && cachedOverview && cachedOverview.expiresAt > now) {
    return cachedOverview.value
  }

  if (!forceRefresh && cachedOverview && cachedOverview.staleAt > now) {
    void refreshPublicOverview()
    return cachedOverview.value
  }

  return refreshPublicOverview()
}

async function refreshPublicOverview(): Promise<PublicOverview> {
  if (!refreshPromise) {
    refreshPromise = computePublicOverview().finally(() => {
      refreshPromise = null
    })
  }

  const value = await refreshPromise
  const now = Date.now()
  cachedOverview = {
    value,
    expiresAt: now + OVERVIEW_CACHE_TTL_MS,
    staleAt: now + OVERVIEW_CACHE_STALE_MS,
  }

  return value
}
