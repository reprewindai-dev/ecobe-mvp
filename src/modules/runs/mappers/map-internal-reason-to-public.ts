import { FALLBACK_PUBLIC_REASON } from '@/modules/runs/contracts/public-run-reasons'
import type { PublicRunStatus } from '@/modules/runs/contracts/public-run-status'

export function mapInternalReasonToPublic(input: {
  internalReasonCode?: string | null
  internalReasonText?: string | null
  status?: string | null
}): string {
  const reasonCode = (input.internalReasonCode ?? '').toLowerCase()
  const reasonText = (input.internalReasonText ?? '').toLowerCase()
  const status = (input.status ?? '').toLowerCase() as PublicRunStatus | ''
  const joined = `${reasonCode} ${reasonText}`.trim()

  if (joined.includes('policy') || joined.includes('blocked') || joined.includes('deny')) {
    return 'policy_violation'
  }

  if (joined.includes('budget') || joined.includes('cost ceiling') || joined.includes('cost')) {
    return 'budget_exceeded'
  }

  if (joined.includes('approval') || status === 'approval_required') {
    return 'human_review_required'
  }

  if (joined.includes('carbon') || joined.includes('reroute') || joined.includes('lower')) {
    return 'lower_carbon_within_latency_budget'
  }

  if (status === 'completed') {
    return 'within_policy_and_budget'
  }

  if (status === 'failed') {
    return 'execution_or_validation_failure'
  }

  return FALLBACK_PUBLIC_REASON
}
