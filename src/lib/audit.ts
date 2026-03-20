import { createHmac } from 'crypto'

import { prisma } from './prisma'
import { env } from './env'

export function signAuditPayload(payload: unknown) {
  return createHmac('sha256', env.AUDIT_SIGNING_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex')
}

export async function createRunEvent(runId: string, organizationId: string, eventType: string, payload: unknown) {
  const signature = signAuditPayload(payload)

  return prisma.runEvent.create({
    data: {
      runId,
      organizationId,
      eventType,
      payload: payload as any,
      signature,
    },
  })
}
