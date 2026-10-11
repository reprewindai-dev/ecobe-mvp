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

// Binds an idempotency key to the signed intent and the exact payload (spec 8,
// B2). Keyed on the intent, not the authority, so re-issuing an authority for
// the same intent can never produce a second mutation.
export function idempotencyKeyFor(intentId: string, payloadHash: string): string {
  return canonicalHash({ intentId, payloadHash })
}

export const GENESIS_STATE_ROOT = '0'.repeat(64)

export type ConditionalExpectations = {
  expectedPreStateRoot?: string
  expectedGeneration?: number
}

export type TargetReceipt = {
  targetClass: TargetClass
  outcome: 'APPLIED' | 'DUPLICATE' | 'REJECTED'
  reason?: string
  key: string
  mutationSequence: number | null
  // Post-mutation state for conditional (compare-and-set) targets.
  generation?: number
  postStateRoot?: string
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

type CommitRecord = {
  key: string
  payloadHash: string
  mutationSequence: number
  generation: number
  postStateRoot: string
}

// Class B2 reference target: one durable mutation per idempotency key, surviving
// restarts, with optional compare-and-set on the target's state root and
// generation. The commit is fsync'd before it is acknowledged, so a crash either
// leaves no commit (safe to retry) or a durable one (retries see DUPLICATE).
export class IdempotentTargetFixture {
  private readonly commits = new Map<string, CommitRecord>()
  private generation = 0
  private stateRoot = GENESIS_STATE_ROOT
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
      let commit: CommitRecord
      try {
        commit = JSON.parse(line) as CommitRecord
      } catch {
        // A torn trailing line was never acknowledged as committed.
        continue
      }
      target.commits.set(commit.key, commit)
      target.generation = commit.generation
      target.stateRoot = commit.postStateRoot
    }
    return target
  }

  mutationCount(): number {
    return this.commits.size
  }

  currentState(): { generation: number; stateRoot: string } {
    return { generation: this.generation, stateRoot: this.stateRoot }
  }

  apply(key: string, payloadHash: string, expectations: ConditionalExpectations = {}): Promise<TargetReceipt> {
    const run = async (): Promise<TargetReceipt> => {
      const rejected = (reason: string) =>
        receipt({ targetClass: 'B2', outcome: 'REJECTED', reason, key, mutationSequence: null })

      // Idempotency is checked before compare-and-set so a retry of an applied
      // intent stays a DUPLICATE even after the state has moved on.
      const existing = this.commits.get(key)
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          return rejected('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD')
        }
        return receipt({
          targetClass: 'B2',
          outcome: 'DUPLICATE',
          key,
          mutationSequence: existing.mutationSequence,
          generation: existing.generation,
          postStateRoot: existing.postStateRoot,
        })
      }
      if (
        expectations.expectedGeneration !== undefined &&
        expectations.expectedGeneration !== this.generation
      ) {
        return rejected('GENERATION_MISMATCH')
      }
      if (
        expectations.expectedPreStateRoot !== undefined &&
        expectations.expectedPreStateRoot !== this.stateRoot
      ) {
        return rejected('PRE_STATE_MISMATCH')
      }

      const commit: CommitRecord = {
        key,
        payloadHash,
        mutationSequence: this.commits.size + 1,
        generation: this.generation + 1,
        postStateRoot: canonicalHash({ previousStateRoot: this.stateRoot, payloadHash }),
      }
      const handle = await open(this.journalPath, 'a')
      try {
        await handle.write(`${JSON.stringify(commit)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.commits.set(key, commit)
      this.generation = commit.generation
      this.stateRoot = commit.postStateRoot
      return receipt({
        targetClass: 'B2',
        outcome: 'APPLIED',
        key,
        mutationSequence: commit.mutationSequence,
        generation: commit.generation,
        postStateRoot: commit.postStateRoot,
      })
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }
}
