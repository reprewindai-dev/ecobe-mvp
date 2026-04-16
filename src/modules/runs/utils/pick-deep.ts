type UnknownRecord = Record<string, unknown>

export function pickDeep<T extends UnknownRecord>(input: T, paths: readonly string[]): Partial<T> {
  const result: UnknownRecord = {}

  for (const rawPath of paths) {
    const path = rawPath.trim()
    if (!path) continue
    const segments = path.split('.')
    const value = getDeep(input, segments)
    if (value === undefined) continue
    setDeep(result, segments, value)
  }

  return result as Partial<T>
}

function getDeep(source: UnknownRecord, segments: string[]): unknown {
  let current: unknown = source
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function setDeep(target: UnknownRecord, segments: string[], value: unknown) {
  let current: UnknownRecord = target
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    const isLeaf = i === segments.length - 1
    if (isLeaf) {
      current[segment] = value
      return
    }

    const next = current[segment]
    if (!isRecord(next)) {
      current[segment] = {}
    }
    current = current[segment] as UnknownRecord
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
