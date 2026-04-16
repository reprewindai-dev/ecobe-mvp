export const PUBLIC_RUN_REASONS = [
  'within_policy_and_budget',
  'lower_carbon_within_latency_budget',
  'policy_violation',
  'budget_exceeded',
  'human_review_required',
  'execution_or_validation_failure',
] as const

export type PublicRunReason = (typeof PUBLIC_RUN_REASONS)[number]

export const FALLBACK_PUBLIC_REASON: PublicRunReason = 'execution_or_validation_failure'
