import { json } from '@/lib/http'
import { buildPublicOverview } from '@/lib/public-overview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const snapshot = await buildPublicOverview()

  return json(snapshot, {
    status: snapshot.status === 'ready' ? 200 : 503,
  })
}
