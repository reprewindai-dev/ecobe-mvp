import type { ExposureContext } from '@/modules/runs/exposure/exposure-tier.types'
import { serializeRunExportRows } from '@/modules/runs/exposure/serialize-run-export'

type AuditExportLike = {
  artifact?: unknown
}

export function sanitizeAuditExportRecord<T extends AuditExportLike>(record: T, ctx: ExposureContext): T {
  if (!record.artifact) {
    return record
  }

  return {
    ...record,
    artifact: serializeRunExportRows(record.artifact, ctx),
  }
}
