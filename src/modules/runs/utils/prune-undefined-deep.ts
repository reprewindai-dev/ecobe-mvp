type UnknownRecord = Record<string, unknown>

export function pruneUndefinedDeep<T>(value: T): T {
  return prune(value) as T
}

function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => prune(entry))
      .filter((entry) => entry !== undefined)
  }

  if (!isRecord(value)) {
    return value
  }

  const output: UnknownRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    const next = prune(entry)
    if (next !== undefined) {
      output[key] = next
    }
  }

  return Object.keys(output).length ? output : undefined
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
