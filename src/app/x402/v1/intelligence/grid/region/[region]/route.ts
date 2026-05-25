import { handleX402Request } from '@/lib/x402/gateway'
import { proxyX402ToEngine } from '@/lib/x402/upstream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ region: string }> }) {
  const { region } = await context.params
  return handleX402Request(request, async () => {
    const upstream = await proxyX402ToEngine({
      request,
      method: 'GET',
      enginePath: 'dashboard/route-coverage',
    })
    const payload = await upstream.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as any).regions)) {
      return Response.json(payload, { status: upstream.status })
    }
    const match = (payload as any).regions.find(
      (item: any) => String(item.regionCode).toLowerCase() === region.toLowerCase(),
    )
    if (!match) {
      return Response.json(
        {
          error: 'Region not found in CO2 Router route coverage',
          region,
        },
        { status: 404 },
      )
    }
    return Response.json({
      generatedAt: (payload as any).generatedAt,
      region: match,
    })
  })
}
