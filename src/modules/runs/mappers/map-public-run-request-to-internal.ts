import type { ParsedRunRequest } from '@/modules/runs/contracts/public-run-request.schema'
import type { LegacyRunRequest, PublicRunRequest } from '@/modules/runs/contracts/public-run.types'

export type NormalizedRunRequest = {
  source: 'public' | 'legacy'
  value: PublicRunRequest
}

export function normalizeRunRequest(parsed: ParsedRunRequest): NormalizedRunRequest {
  if (parsed.source === 'public') {
    return {
      source: 'public',
      value: parsed.value,
    }
  }

  return {
    source: 'legacy',
    value: normalizeLegacyRequest(parsed.value),
  }
}

export type InternalGovernedRunRequest = Record<string, unknown>

export function mapPublicRunRequestToInternal(
  input: PublicRunRequest,
  ctx: {
    organizationId: string
    projectId?: string
    environmentSlug?: string
  }
): InternalGovernedRunRequest {
  return {
    projectId: ctx.projectId,
    environmentSlug: input.environment || ctx.environmentSlug || 'production',
    input: input.workload.input,
    operation: input.workload.operation,
    schema: input.workload.schema,
    model: input.workload.model,
    temperature: input.workload.temperature,
    tokenCount: input.workload.estimatedUsage?.tokenCount,
    requestCount: input.workload.estimatedUsage?.requestCount,
    latencyCeiling: input.constraints?.latencyMs,
    costCeiling: input.constraints?.costUsd,
    carbonPolicy: input.constraints?.carbon
      ? { maxCarbonGPerKwh: input.constraints.carbon.maxCarbonGPerKwh }
      : undefined,
    waterPolicy: input.constraints?.water?.mode,
    energyPreference: input.constraints?.energy?.preference,
    providerConstraints: {
      providers: input.targets?.providers,
      preferredRegions: input.targets?.preferredRegions,
    },
    metadata: {
      organizationId: ctx.organizationId,
      requestId: input.metadata?.requestId,
      customerRef: input.metadata?.customerRef,
      traceId: input.metadata?.traceId,
      projectId: input.metadata?.projectId,
      projectSlug: input.metadata?.projectSlug,
    },
  }
}

function normalizeLegacyRequest(value: LegacyRunRequest): PublicRunRequest {
  return {
    environment: value.environmentSlug ?? 'production',
    workload: {
      type: 'other',
      operation: value.operation ?? 'governed-run',
      input: value.input,
      schema: value.schema,
      model: value.model,
      temperature: value.temperature,
      estimatedUsage: {
        tokenCount: value.tokenCount,
        requestCount: value.requestCount,
      },
    },
    constraints: {
      latencyMs: value.latencyCeiling,
      costUsd: value.costCeiling,
      carbon: value.carbonPolicy
        ? { maxCarbonGPerKwh: value.carbonPolicy.maxCarbonGPerKwh }
        : undefined,
    },
    targets: {
      providers: value.providerConstraints?.providers,
      preferredRegions: value.providerConstraints?.preferredRegions,
    },
    metadata: {
      projectId: value.projectId,
    },
  }
}
