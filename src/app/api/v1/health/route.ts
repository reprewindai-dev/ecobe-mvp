import { prisma } from '@/lib/prisma'
import { json } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return json({
      status: 'healthy',
      service: 'ecobe-mvp',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 503 })
  }
}
