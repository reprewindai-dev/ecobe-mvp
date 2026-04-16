import { orchestrateRun } from '@/lib/run-orchestrator'
import { prisma } from '@/lib/prisma'

export async function orchestrateGovernedRun(input: {
  actor: {
    id?: string
    organizationId: string
    projectId?: string
  }
  payload: Record<string, unknown>
}) {
  return orchestrateRun(input.actor, input.payload)
}

export async function getGovernedRunById(input: {
  id: string
  organizationId?: string
}) {
  return prisma.run.findFirst({
    where: {
      id: input.id,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    },
  })
}

export async function getGovernedRunEvents(input: {
  runId: string
  organizationId?: string
}) {
  return prisma.runEvent.findMany({
    where: {
      runId: input.runId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
}
