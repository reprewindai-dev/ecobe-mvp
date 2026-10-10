import { createHash } from 'node:crypto'

// Canonical JSON for signed authority material. Keys are ordered by UTF-16 code
// units (RFC 8785 ordering, independent of locale), non-finite numbers are
// rejected, and -0 is normalized to 0 so equal values always hash equally.
function canonicalize(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path || '(root)'}`)
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested, path ? `${path}.${key}` : key)]),
    )
  }
  throw new TypeError(`Unsupported value of type ${typeof value} at ${path || '(root)'}`)
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(value, '')), 'utf8')
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJsonBytes(value))
}
