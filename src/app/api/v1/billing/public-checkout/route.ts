import { z } from 'zod'

import { createPublicStripeCheckoutSession } from '@/lib/billing'
import { badRequest, json } from '@/lib/http'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().email(),
  planTier: z.enum(['tier_1', 'tier_2', 'tier_3']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
})

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid public checkout payload', parsed.error.flatten())
  }

  try {
    const session = await createPublicStripeCheckoutSession({
      email: parsed.data.email,
      planTier: parsed.data.planTier,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
    })

    return json(session, { status: 201 })
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unable to create checkout session' },
      { status: 503 },
    )
  }
}
