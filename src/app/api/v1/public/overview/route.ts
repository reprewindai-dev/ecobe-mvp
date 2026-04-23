import { json } from '@/lib/http'
import { buildFallbackPublicOverview, buildPublicOverview } from '@/lib/public-overview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const snapshot = await buildPublicOverview().catch(() => buildFallbackPublicOverview())

  return json(snapshot, {
    status: snapshot.status === 'ready' ? 200 : 503,
    headers: {
      'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=45',
    },
  })
}
