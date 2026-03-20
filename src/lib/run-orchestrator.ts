import { randomUUID } from 'crypto'

import { prisma } from './prisma'
import { createRunEvent } from './audit'
import { assertRunEntitlements } from './billing'
import { evaluateSeked } from './seked'
import { evaluateConvergeos } from './convergeos'
import { createRoutingDecision, executeAllocation } from './engine'

export async function orchestrateRun(apiKey: any, payload: Record<string, any>) {
  const organizationId = apiKey.organizationId
  const projectId = apiKey.projectId ?? payload.projectId
  const environmentSlug = payload.environmentSlug ?? 'production'

  if (!projectId) {
    throw new Error('API key is not scoped to a project')
  }

  await assertRunEntitlements(organizationId, payload)

  const environment = await prisma.environment.upsert({
    where: {
      projectId_slug: {
        projectId,
        slug: environmentSlug,
      },
    },
    update: { name: environmentSlug },
    create: {
      projectId,
      name: environmentSlug,
      slug: environmentSlug,
    },
  })

  const policyVersion = await prisma.policyVersion.findFirst({
    where: {
      isActive: true,
      policyProfile: {
        organizationId,
        OR: [{ projectId }, { projectId: null }],
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const seked = await evaluateSeked(payload.input ?? payload, policyVersion?.rules as Record<string, any> | undefined)
  const convergeos = await evaluateConvergeos(payload.input ?? payload)
  const correlationId = randomUUID()

  const run = await prisma.run.create({
    data: {
      organizationId,
      projectId,
      environmentId: environment.id,
      apiKeyId: apiKey.id,
      policyVersionId: policyVersion?.id,
      correlationId,
      status: seked.blocked ? 'blocked' : seked.requiresApproval ? 'approval_required' : 'pending',
      inputPayload: (payload.input ?? payload) as any,
      blockedReason: seked.blockReason,
      approvalRequired: seked.requiresApproval,
    },
  })

  await createRunEvent(run.id, organizationId, 'run.received', {
    correlationId,
    input: payload.input ?? payload,
  })

  if (seked.blocked) {
    const envelope = {
      runId: run.id,
      status: 'blocked',
      result: null,
      seked: {
        score: seked.score,
        drift: seked.drift,
        fracture: seked.fracture,
        tier: seked.tier,
      },
      convergeos: {
        attemptCount: convergeos.attemptCount,
        schemaValid: convergeos.schemaValid,
        qualityScore: convergeos.qualityScore,
        finalDecision: convergeos.finalDecision,
      },
      ecobe: null,
      auditId: run.id,
    }

    await prisma.run.update({
      where: { id: run.id },
      data: {
        resultEnvelope: envelope as any,
        auditId: run.id,
      },
    })

    await createRunEvent(run.id, organizationId, 'run.blocked', envelope)
    return envelope
  }

  if (seked.requiresApproval) {
    await prisma.approvalRequest.create({
      data: {
        organizationId,
        runId: run.id,
        reason: 'Seked elevated this run for approval',
      },
    })

    const envelope = {
      runId: run.id,
      status: 'approval_required',
      result: null,
      seked: {
        score: seked.score,
        drift: seked.drift,
        fracture: seked.fracture,
        tier: seked.tier,
      },
      convergeos: {
        attemptCount: convergeos.attemptCount,
        schemaValid: convergeos.schemaValid,
        qualityScore: convergeos.qualityScore,
        finalDecision: convergeos.finalDecision,
      },
      ecobe: null,
      auditId: run.id,
    }

    await prisma.run.update({
      where: { id: run.id },
      data: {
        resultEnvelope: envelope as any,
        auditId: run.id,
      },
    })

    await createRunEvent(run.id, organizationId, 'run.approval_required', envelope)
    return envelope
  }

  if (!convergeos.schemaValid) {
    const envelope = {
      runId: run.id,
      status: 'failed',
      result: null,
      seked: {
        score: seked.score,
        drift: seked.drift,
        fracture: seked.fracture,
        tier: seked.tier,
      },
      convergeos: {
        attemptCount: convergeos.attemptCount,
        schemaValid: convergeos.schemaValid,
        qualityScore: convergeos.qualityScore,
        finalDecision: convergeos.finalDecision,
      },
      ecobe: null,
      auditId: run.id,
    }

    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        resultEnvelope: envelope as any,
        auditId: run.id,
      },
    })

    await createRunEvent(run.id, organizationId, 'run.failed', envelope)
    return envelope
  }

  const engineDecision = await createRoutingDecision({
    runId: run.id,
    orgId: organizationId,
    projectId,
    providerConstraints: payload.providerConstraints ?? {},
    latencyCeiling: payload.latencyCeiling,
    costCeiling: payload.costCeiling,
    carbonPolicy: payload.carbonPolicy ?? {},
    executionMetadata: {
      model: payload.model,
      tokenCount: payload.tokenCount,
      operation: payload.operation ?? 'governed-run',
      requestCount: payload.requestCount ?? 1,
      estimatedKwh: payload.estimatedKwh ?? 0.08,
    },
  })

  const allocation = await executeAllocation(engineDecision.decisionId)

  const envelope = {
    runId: run.id,
    status: 'completed',
    result: {
      executionReference: allocation.executionReference,
      output: payload.output ?? { accepted: true },
    },
    seked: {
      score: seked.score,
      drift: seked.drift,
      fracture: seked.fracture,
      tier: seked.tier,
    },
    convergeos: {
      attemptCount: convergeos.attemptCount,
      schemaValid: convergeos.schemaValid,
      qualityScore: convergeos.qualityScore,
      finalDecision: convergeos.finalDecision,
    },
    ecobe: {
      provider: engineDecision.selectedProvider,
      region: engineDecision.selectedRegion,
      estimatedLatency: engineDecision.estimatedLatency,
      estimatedCost: engineDecision.estimatedCost,
      carbonEstimate: engineDecision.carbonEstimate,
      decisionReason: engineDecision.decisionReason,
    },
    auditId: run.id,
  }

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: 'completed',
      resultPayload: envelope.result as any,
      resultEnvelope: envelope as any,
      auditId: run.id,
    },
  })

  await prisma.usageRecord.create({
    data: {
      organizationId,
      projectId,
      runId: run.id,
      metric: 'governed_run',
      quantity: 1,
      unit: 'run',
      amountUsd: Number(engineDecision.estimatedCost ?? 0),
    },
  })

  await createRunEvent(run.id, organizationId, 'run.completed', envelope)
  return envelope
}
