type UnknownRecord = Record<string, unknown>

export function omitDeep<T>(input: T, blockedKeys: readonly string[]): T {
  const blocked = new Set(blockedKeys.map((key) => key.toLowerCase()))
  return visit(input, blocked) as T
}

function visit(value: unknown, blocked: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => visit(entry, blocked))
  }

  if (!isRecord(value)) {
    return value
  }

  const output: UnknownRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isBlockedKey(key, blocked)) {
      continue
    }
    output[key] = visit(entry, blocked)
  }
  return output
}

function isBlockedKey(key: string, blocked: Set<string>) {
  if (blocked.has(key.toLowerCase())) {
    return true
  }
  return key.toLowerCase().startsWith('debug')
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
