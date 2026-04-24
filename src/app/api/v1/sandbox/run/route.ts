import crypto from 'crypto'

import { json, badRequest } from '@/lib/http'
import { env, engineConfigured } from '@/lib/env'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  scenario: z.string().min(1).optional(),
})

type EngineAuthorizeResponse = {
  decision?: 'run_now' | 'reroute' | 'delay' | 'throttle' | 'deny'
  decisionFrameId?: string
  selectedRegion?: string | null
  reasonCode?: string | null
  recommendation?: string | null
  proofHash?: string | null
  latencyMs?: number | { total?: number } | null
  delayMinutes?: number | null
}

type SandboxLane = 'prod' | 'staging' | 'experiments' | 'overline' | 'needs_two_keys'

type SandboxLaneResponse = {
  lane: SandboxLane
  label: string
  outcome: 'run_now' | 'run_later' | 'rejected' | 'needs_override'
  region: string | null
  scheduled_time: string | null
  reasons: string[]
  hard_stops_triggered: string[]
  override_required: boolean
  decision_id: string | null
  latency_ms: number | null
}

type SandboxRunResponse = {
  run_id: string
  scenario: string
  lanes: SandboxLaneResponse[]
}

type LaneDefinition = {
  lane: SandboxLane
  label: string
  request: Record<string, unknown>
  reasons: string[]
  hardStopsTriggered?: string[]
  overrideRequired?: boolean
}

function getEngineHeaders() {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
    'x-ecobe-internal-key': env.ECOBE_ENGINE_INTERNAL_KEY,
    'x-api-key': env.ECOBE_ENGINE_INTERNAL_KEY,
    'x-ecobe-broker-id': env.ECOBE_BROKER_ID,
  }
}

function getLatencyMs(latencyMs: EngineAuthorizeResponse['latencyMs']) {
  if (typeof latencyMs === 'number') return latencyMs
  if (latencyMs && typeof latencyMs === 'object' && typeof latencyMs.total === 'number') {
    return latencyMs.total
  }
  return null
}

function mapDecision(decision: EngineAuthorizeResponse['decision']) {
  if (decision === 'delay') return 'run_later' as const
  if (decision === 'throttle') return 'needs_override' as const
  if (decision === 'deny') return 'rejected' as const
  return 'run_now' as const
}

function buildRunId() {
  const stamp = new Date().toISOString().slice(0, 10)
  const suffix = crypto.randomUUID().slice(0, 8)
  return `sample-${stamp}-${suffix}`
}

function buildLaneDefinitions(scenario: string): LaneDefinition[] {
  const workload = {
    name: 'nightly-analytics-batch',
    type: 'batch',
    estimated_duration_minutes: 45,
  }

  const baseMetadata = {
    scenario,
    workload: workload.name,
  }

  return [
    {
      lane: 'prod',
      label: 'Lane 1 - Production',
      request: {
        scenario,
        workload,
        preferredRegions: ['us-east-1', 'us-west-2', 'ca-central-1'],
        carbonWeight: 0.7,
        waterWeight: 0.25,
        latencyWeight: 0.2,
        costWeight: 0.1,
        jobType: 'heavy',
        criticality: 'standard',
        waterPolicyProfile: 'default',
        allowDelay: true,
        decisionMode: 'runtime_authorization',
        criticalPath: false,
        signalPolicy: 'marginal_first',
        estimatedEnergyKwh: 45,
        metadata: {
          ...baseMetadata,
          environment: 'prod',
          risk_profile: 'normal',
          budget_level: 'normal',
          override_flag: false,
        },
      },
      reasons: [
        'Meets production policy, SLA, and region rules.',
        'Budget and impact stay within the production guardrails.',
      ],
    },
    {
      lane: 'staging',
      label: 'Lane 2 - Staging',
      request: {
        scenario,
        workload,
        preferredRegions: ['us-west-2', 'us-east-1', 'eu-west-1'],
        carbonWeight: 0.6,
        waterWeight: 0.2,
        latencyWeight: 0.25,
        costWeight: 0.15,
        jobType: 'standard',
        criticality: 'standard',
        waterPolicyProfile: 'default',
        allowDelay: true,
        decisionMode: 'runtime_authorization',
        criticalPath: false,
        signalPolicy: 'marginal_first',
        estimatedEnergyKwh: 24,
        metadata: {
          ...baseMetadata,
          environment: 'staging',
          risk_profile: 'normal',
          budget_level: 'normal',
          override_flag: false,
        },
      },
      reasons: [
        'Staging policies are looser on placement.',
        'The engine can take advantage of a cheaper or cleaner lane here.',
      ],
    },
    {
      lane: 'experiments',
      label: 'Lane 3 - Experiments',
      request: {
        scenario,
        workload,
        preferredRegions: ['eu-west-1', 'eu-central-1', 'us-east-1'],
        carbonWeight: 0.55,
        waterWeight: 0.2,
        latencyWeight: 0.15,
        costWeight: 0.3,
        jobType: 'batch',
        criticality: 'batch',
        waterPolicyProfile: 'eu_data_center_reporting',
        allowDelay: true,
        decisionMode: 'scenario_planning',
        criticalPath: false,
        signalPolicy: 'marginal_first',
        estimatedEnergyKwh: 12,
        metadata: {
          ...baseMetadata,
          environment: 'dev',
          risk_profile: 'closer_to_edge',
          budget_level: 'normal',
          override_flag: false,
        },
      },
      reasons: [
        'This lane is marked closer to the edge for learning purposes.',
        'CO2 Router still stays inside guardrails while exploring cleaner options.',
      ],
    },
    {
      lane: 'overline',
      label: 'Lane 4 - Over the line',
      request: {
        scenario,
        workload,
        preferredRegions: ['us-east-1'],
        carbonWeight: 0.8,
        waterWeight: 0.35,
        latencyWeight: 0.1,
        costWeight: 0.05,
        jobType: 'heavy',
        criticality: 'critical',
        waterPolicyProfile: 'high_water_sensitivity',
        allowDelay: false,
        decisionMode: 'runtime_authorization',
        criticalPath: true,
        signalPolicy: 'marginal_first',
        maxDelayMinutes: 0,
        estimatedEnergyKwh: 500,
        metadata: {
          ...baseMetadata,
          environment: 'prod',
          risk_profile: 'normal',
          budget_level: 'tight',
          override_flag: false,
        },
      },
      reasons: [
        'This lane is intentionally constrained to surface a hard stop if the policy rejects it.',
        'The demo keeps the real engine in the loop rather than faking a failure state.',
      ],
      hardStopsTriggered: ['prod_budget_limit'],
    },
    {
      lane: 'needs_two_keys',
      label: 'Lane 5 - Needs two keys',
      request: {
        scenario,
        workload,
        preferredRegions: ['us-east-1', 'us-west-2'],
        carbonWeight: 0.65,
        waterWeight: 0.3,
        latencyWeight: 0.15,
        costWeight: 0.1,
        jobType: 'heavy',
        criticality: 'critical',
        waterPolicyProfile: 'high_water_sensitivity',
        allowDelay: true,
        decisionMode: 'runtime_authorization',
        criticalPath: true,
        signalPolicy: 'marginal_first',
        maxDelayMinutes: 120,
        estimatedEnergyKwh: 250,
        metadata: {
          ...baseMetadata,
          environment: 'prod',
          risk_profile: 'high_risk',
          budget_level: 'normal',
          override_flag: true,
        },
      },
      reasons: [
        'Trips a high-risk guardrail that requires human approval.',
        'The engine records the decision so operators can replay the exact path later.',
      ],
      overrideRequired: true,
    },
  ]
}

async function callEngine(input: Record<string, unknown>): Promise<EngineAuthorizeResponse> {
  const response = await fetch(`${env.ECOBE_ENGINE_URL}/api/v1/ci/authorize`, {
    method: 'POST',
    headers: getEngineHeaders(),
    body: JSON.stringify(input),
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `Engine authorization failed (${response.status})`)
  }

  return (await response.json()) as EngineAuthorizeResponse
}

function normalizeLane(definition: LaneDefinition, response: EngineAuthorizeResponse): SandboxLaneResponse {
  const decision = mapDecision(response.decision)
  const overrideRequired = Boolean(definition.overrideRequired || response.decision === 'throttle')
  const outcome =
    definition.lane === 'needs_two_keys' && overrideRequired
      ? 'needs_override'
      : decision

  const reasonCode = response.reasonCode ?? null
  const recommendation = response.recommendation ?? null
  const generatedReasons = [
    ...(definition.reasons ?? []),
    reasonCode ? `Engine reason: ${reasonCode}` : null,
    recommendation ? recommendation : null,
  ].filter((value): value is string => Boolean(value))

  return {
    lane: definition.lane,
    label: definition.label,
    outcome,
    region: response.selectedRegion ?? null,
    scheduled_time:
      response.decision === 'delay' && typeof response.delayMinutes === 'number'
        ? new Date(Date.now() + response.delayMinutes * 60_000).toISOString()
        : null,
    reasons: generatedReasons.slice(0, 2),
    hard_stops_triggered:
      definition.hardStopsTriggered?.length && outcome === 'rejected'
        ? definition.hardStopsTriggered
        : [],
    override_required: overrideRequired,
    decision_id: response.decisionFrameId ?? null,
    latency_ms: getLatencyMs(response.latencyMs),
  }
}

export async function runSandboxSample(input: unknown): Promise<SandboxRunResponse> {
  if (!engineConfigured()) {
    throw new Error('MVP engine bridge is not configured.')
  }

  const parsed = requestSchema.parse(input)
  const scenario = parsed.scenario ?? 'nightly_analytics_batch'
  const laneDefinitions = buildLaneDefinitions(scenario)
  const responses = await Promise.all(
    laneDefinitions.map(async (laneDefinition) => {
      try {
        const response = await callEngine(laneDefinition.request)
        return normalizeLane(laneDefinition, response)
      } catch (error) {
        return {
          lane: laneDefinition.lane,
          label: laneDefinition.label,
          outcome: 'rejected' as const,
          region: null,
          scheduled_time: null,
          reasons: [
            ...laneDefinition.reasons,
            error instanceof Error ? error.message : 'Decision service unavailable',
          ].slice(0, 2),
          hard_stops_triggered: ['engine_unavailable'],
          override_required: Boolean(laneDefinition.overrideRequired),
          decision_id: null,
          latency_ms: null,
        }
      }
    })
  )

  return {
    run_id: buildRunId(),
    scenario,
    lanes: responses,
  }
}

export async function POST(request: Request) {
  if (!engineConfigured()) {
    return json({ error: 'MVP engine bridge is not configured.' }, { status: 503 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await runSandboxSample(body)
    return json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest('Invalid sandbox payload', error.flatten())
    }

    return json(
      { error: error instanceof Error ? error.message : 'Sandbox run failed' },
      { status: 500 }
    )
  }
}
