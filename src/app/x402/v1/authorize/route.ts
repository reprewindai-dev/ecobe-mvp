import { handleX402Request } from '@/lib/x402/gateway'
import { proxyX402ToEngine } from '@/lib/x402/upstream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleX402Request(request, (body) =>
    proxyX402ToEngine({
      request,
      method: 'POST',
      enginePath: 'ci/authorize',
      body,
    }),
  )
}
