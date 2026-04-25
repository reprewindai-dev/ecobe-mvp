import { json } from '@/lib/http'
import { env, engineConfigured } from '@/lib/env'
import { warmSandboxSample } from '@/lib/sandbox-demo'

export const dynamic = 'force-dynamic'

function isWarmRequestAllowed(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const userAgent = request.headers.get('user-agent') ?? ''
  const token = env.SANDBOX_WARM_TOKEN || env.CRON_SECRET

  if (token && authorization === `Bearer ${token}`) {
    return true
  }

  return userAgent.toLowerCase().includes('vercel-cron')
}

export async function GET(request: Request) {
  if (!isWarmRequestAllowed(request)) {
    return json({ error: 'Unauthorized sandbox warm request' }, { status: 401 })
  }

  if (!engineConfigured()) {
    return json({ error: 'MVP engine bridge is not configured.' }, { status: 503 })
  }

  try {
    const result = await warmSandboxSample({})
    return json({
      status: 'warmed',
      run_id: result.run_id,
      lane_count: result.lanes.length,
      refreshed_at: result.cache?.refreshed_at ?? new Date().toISOString(),
    })
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Sandbox warm failed' },
      { status: 500 }
    )
  }
}
