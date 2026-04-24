import { prisma } from '@/lib/prisma'
import { json } from '@/lib/http'
import { getEngineHealth } from '@/lib/engine'
import { getSekedHealth } from '@/lib/seked'
import { getConvergeosHealth } from '@/lib/convergeos'

export const dynamic = 'force-dynamic'

export async function GET() {
  let database = false

  try {
    await prisma.$queryRaw`SELECT 1`
    database = true
  } catch {
    database = false
  }

  const [engine, seked, convergeos] = await Promise.all([
    getEngineHealth(),
    getSekedHealth(),
    getConvergeosHealth(),
  ])

  const isOptionalDependencyReady = (status: string) =>
    status === 'healthy' || status === 'not_configured' || status === 'missing_dependency'

  const ready =
    database &&
    ['healthy', 'ok', 'not_configured'].includes(engine.status) &&
    isOptionalDependencyReady(seked.status) &&
    isOptionalDependencyReady(convergeos.status)

  return json({
    status: ready ? 'ready' : 'degraded',
    checks: {
      database,
      engine,
      seked,
      convergeos,
    },
  }, { status: ready ? 200 : 503 })
}
