import { mkdir, open, readFile } from 'node:fs/promises'
import path from 'node:path'

import { canonicalHash } from './canonical'

// Target classes from the locked spec, section 8.
export type TargetClass = 'B1' | 'B2' | 'C'
export type Connectivity = 'CONFIRMED' | 'PARTITIONED' | 'AMBIGUOUS'

export type AutonomyDecision = { allowed: true } | { allowed: false; reason: string }

export function autonomousExecutionAllowed(input: {
  targetClass: TargetClass
  connectivity: Connectivity
  currentHumanAuthorization: boolean
}): AutonomyDecision {
  if (input.targetClass !== 'C') return { allowed: true }
  if (input.connectivity !== 'CONFIRMED') {
    return { allowed: false, reason: 'CLASS_C_REQUIRES_CONFIRMED_CONNECTIVITY' }
  }
  if (!input.currentHumanAuthorization) {
    return { allowed: false, reason: 'CLASS_C_REQUIRES_CURRENT_HUMAN_AUTHORIZATION' }
  }
  return { allowed: true }
}

// Binds an idempotency key to the authority and the exact payload (spec 8, B2).
export function idempotencyKeyFor(authorityId: string, payloadHash: string): string {
  return canonicalHash({ authorityId, payloadHash })
}

export type TargetReceipt = {
  targetClass: TargetClass
  outcome: 'APPLIED' | 'DUPLICATE' | 'REJECTED'
  reason?: string
  key: string
  mutationSequence: number | null
  receiptHash: string
}

function receipt(fields: Omit<TargetReceipt, 'receiptHash'>): TargetReceipt {
  return { ...fields, receiptHash: canonicalHash(fields) }
}

// Class B1 reference target: persists the highest accepted writer generation
// and rejects any generation that is not strictly newer.
export class FencedTargetFixture {
  private highestGeneration = -1
  private mutations = 0

  apply(generation: number, key: string): TargetReceipt {
    if (!Number.isSafeInteger(generation) || generation <= this.highestGeneration) {
      return receipt({
        targetClass: 'B1',
        outcome: 'REJECTED',
        reason: 'STALE_GENERATION',
        key,
        mutationSequence: null,
      })
    }
    this.highestGeneration = generation
    this.mutations += 1
    return receipt({ targetClass: 'B1', outcome: 'APPLIED', key, mutationSequence: this.mutations })
  }

  mutationCount(): number {
    return this.mutations
  }
}

type CommitRecord = { key: string; payloadHash: string; mutationSequence: number }

// Class B2 reference target: one durable mutation per idempotency key, surviving
// restarts. The commit is fsync'd before it is acknowledged, so a crash either
// leaves no commit (safe to retry) or a durable one (retries see DUPLICATE).
export class IdempotentTargetFixture {
  private readonly commits = new Map<string, CommitRecord>()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(private readonly journalPath: string) {}

  static async open(journalPath: string): Promise<IdempotentTargetFixture> {
    const target = new IdempotentTargetFixture(journalPath)
    await mkdir(path.dirname(journalPath), { recursive: true })
    let raw = ''
    try {
      raw = await readFile(journalPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const commit = JSON.parse(line) as CommitRecord
        target.commits.set(commit.key, commit)
      } catch {
        // A torn trailing line was never acknowledged as committed.
      }
    }
    return target
  }

  mutationCount(): number {
    return this.commits.size
  }

  apply(key: string, payloadHash: string): Promise<TargetReceipt> {
    const run = async (): Promise<TargetReceipt> => {
      const existing = this.commits.get(key)
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          return receipt({
            targetClass: 'B2',
            outcome: 'REJECTED',
            reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
            key,
            mutationSequence: null,
          })
        }
        return receipt({
          targetClass: 'B2',
          outcome: 'DUPLICATE',
          key,
          mutationSequence: existing.mutationSequence,
        })
      }
      const commit: CommitRecord = { key, payloadHash, mutationSequence: this.commits.size + 1 }
      const handle = await open(this.journalPath, 'a')
      try {
        await handle.write(`${JSON.stringify(commit)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.commits.set(key, commit)
      return receipt({ targetClass: 'B2', outcome: 'APPLIED', key, mutationSequence: commit.mutationSequence })
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }
}
