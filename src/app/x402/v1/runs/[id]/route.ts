import { handleX402Request } from '@/lib/x402/gateway'
import { proxyX402ToEngine } from '@/lib/x402/upstream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return handleX402Request(request, () =>
    proxyX402ToEngine({
      request,
      method: 'GET',
      enginePath: `ci/decisions/${encodeURIComponent(id)}/replay`,
    }),
  )
}
