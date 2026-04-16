export const PUBLIC_RUN_STATUSES = ['completed', 'blocked', 'approval_required', 'failed'] as const

export type PublicRunStatus = (typeof PUBLIC_RUN_STATUSES)[number]
