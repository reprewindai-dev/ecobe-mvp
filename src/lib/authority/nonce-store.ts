import { mkdir, open, readFile } from 'node:fs/promises'
import path from 'node:path'

export type NonceConsumeResult = 'CONSUMED' | 'REPLAYED'

export interface NonceStore {
  consume(nonce: string, expiresAt: Date, now?: Date): Promise<NonceConsumeResult>
}

type NonceRecord = { nonce: string; expiresAt: string; consumedAt: string }

// Append-only, fsync'd nonce journal. A nonce stays consumed at least until its
// authority expires, across process restarts (spec section 13: the replay
// cache must be durable for the authority lifetime).
export class FileNonceStore implements NonceStore {
  private readonly consumed = new Map<string, number>()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(private readonly journalPath: string) {}

  static async open(journalPath: string, now: Date = new Date()): Promise<FileNonceStore> {
    const store = new FileNonceStore(journalPath)
    await mkdir(path.dirname(journalPath), { recursive: true })
    let raw = ''
    try {
      raw = await readFile(journalPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let record: NonceRecord
      try {
        record = JSON.parse(line) as NonceRecord
      } catch {
        // A torn final line from a crash mid-append never acknowledged a consume.
        continue
      }
      const expiresAt = Date.parse(record.expiresAt)
      if (Number.isFinite(expiresAt) && expiresAt >= now.getTime()) {
        store.consumed.set(record.nonce, expiresAt)
      }
    }
    return store
  }

  consume(nonce: string, expiresAt: Date, now: Date = new Date()): Promise<NonceConsumeResult> {
    const run = async (): Promise<NonceConsumeResult> => {
      const knownExpiry = this.consumed.get(nonce)
      if (knownExpiry !== undefined && knownExpiry >= now.getTime()) return 'REPLAYED'

      const record: NonceRecord = {
        nonce,
        expiresAt: expiresAt.toISOString(),
        consumedAt: now.toISOString(),
      }
      const handle = await open(this.journalPath, 'a')
      try {
        await handle.write(`${JSON.stringify(record)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.consumed.set(nonce, expiresAt.getTime())
      return 'CONSUMED'
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }
}
