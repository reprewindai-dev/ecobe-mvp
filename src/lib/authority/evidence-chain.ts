import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

import { canonicalHash, canonicalJsonBytes } from './canonical'

// Evidence links from the locked spec, section 11.
export type EvidenceType =
  | 'request'
  | 'license'
  | 'authority'
  | 'policy'
  | 'signals'
  | 'decision'
  | 'execution_attempt'
  | 'target_ack'
  | 'outcome'

export const GENESIS_HASH = '0'.repeat(64)

export type EvidenceRecord = {
  sequence: number
  type: EvidenceType
  recordedAt: string
  data: Record<string, unknown>
  previousHash: string
  hash: string
}

export type WitnessRoot = {
  headHash: string
  sequence: number
  createdAt: string
  keyId: string
  algorithm: 'Ed25519'
  signature: string
}

export class EvidenceIntegrityError extends Error {
  constructor(
    message: string,
    public readonly sequence?: number,
  ) {
    super(message)
    this.name = 'EvidenceIntegrityError'
  }
}

function recordHash(record: Omit<EvidenceRecord, 'hash'>): string {
  return canonicalHash({
    sequence: record.sequence,
    type: record.type,
    recordedAt: record.recordedAt,
    data: record.data,
    previousHash: record.previousHash,
  })
}

function witnessSigningBytes(root: Omit<WitnessRoot, 'signature'>): Buffer {
  return canonicalJsonBytes(root)
}

// Recomputes every record hash and every link; the evidence is only as good as
// this check (a stored hash is never trusted on its own).
export function verifyEvidenceRecords(records: readonly EvidenceRecord[]): string {
  let previousHash = GENESIS_HASH
  records.forEach((record, index) => {
    const expectedSequence = index + 1
    if (record.sequence !== expectedSequence) {
      throw new EvidenceIntegrityError(`Expected sequence ${expectedSequence}`, record.sequence)
    }
    if (record.previousHash !== previousHash) {
      throw new EvidenceIntegrityError('Broken hash link', record.sequence)
    }
    if (recordHash(record) !== record.hash) {
      throw new EvidenceIntegrityError('Record hash does not match its contents', record.sequence)
    }
    previousHash = record.hash
  })
  return previousHash
}

export function signWitnessRoot(
  records: readonly EvidenceRecord[],
  keyId: string,
  privateKeyPem: string,
  now: Date = new Date(),
): WitnessRoot {
  const headHash = verifyEvidenceRecords(records)
  const unsigned = {
    headHash,
    sequence: records.length,
    createdAt: now.toISOString(),
    keyId,
    algorithm: 'Ed25519' as const,
  }
  const signature = sign(null, witnessSigningBytes(unsigned), createPrivateKey(privateKeyPem))
  return { ...unsigned, signature: signature.toString('base64url') }
}

// Verifies the chain, the witness signature, and that the witness pins the
// recorded head. Records appended after the witness are verified as a chain
// but are not covered by this witness.
export function verifyWitnessedEvidence(
  records: readonly EvidenceRecord[],
  witness: WitnessRoot,
  trustedPublicKeys: ReadonlyMap<string, string>,
): void {
  verifyEvidenceRecords(records)
  const publicKeyPem = trustedPublicKeys.get(witness.keyId)
  if (!publicKeyPem) throw new EvidenceIntegrityError('Witness key is not trusted')
  const { signature, ...unsigned } = witness
  let authentic = false
  try {
    authentic = verify(
      null,
      witnessSigningBytes(unsigned),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    )
  } catch {
    authentic = false
  }
  if (!authentic) throw new EvidenceIntegrityError('Witness signature is invalid')
  if (witness.sequence < 1 || witness.sequence > records.length) {
    throw new EvidenceIntegrityError('Witness does not cover the available records')
  }
  if (records[witness.sequence - 1].hash !== witness.headHash) {
    throw new EvidenceIntegrityError('Witness head does not match the recorded chain', witness.sequence)
  }
}

function parseJournal(raw: string): EvidenceRecord[] {
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as EvidenceRecord
      } catch {
        throw new EvidenceIntegrityError('Unreadable evidence record', index + 1)
      }
    })
}

async function appendDurably(filePath: string, line: string) {
  const handle = await open(filePath, 'a')
  try {
    await handle.write(line)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

// Append-only, hash-chained evidence journal. Described as signed and
// tamper-evident, not immutable (spec section 11): it detects edits, it does
// not prevent them.
export class EvidenceJournal {
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly journalPath: string,
    private readonly records: EvidenceRecord[],
  ) {}

  static async open(journalPath: string): Promise<EvidenceJournal> {
    await mkdir(path.dirname(journalPath), { recursive: true })
    let raw = ''
    try {
      raw = await readFile(journalPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const records = parseJournal(raw)
    verifyEvidenceRecords(records)
    return new EvidenceJournal(journalPath, records)
  }

  // Rebuilds a lost journal from exported records, accepting them only if they
  // verify against a trusted witness root. A genuine but older witness would
  // also verify, so callers pass the high-water mark (last known sequence)
  // kept outside the journal to reject rollback to an older snapshot.
  static async restore(
    journalPath: string,
    records: readonly EvidenceRecord[],
    witness: WitnessRoot,
    trustedPublicKeys: ReadonlyMap<string, string>,
    options: { minimumSequence?: number } = {},
  ): Promise<EvidenceJournal> {
    verifyWitnessedEvidence(records, witness, trustedPublicKeys)
    if (options.minimumSequence !== undefined && witness.sequence < options.minimumSequence) {
      throw new EvidenceIntegrityError(
        `Witness sequence ${witness.sequence} is older than the recorded high-water mark ${options.minimumSequence}`,
        witness.sequence,
      )
    }
    await mkdir(path.dirname(journalPath), { recursive: true })
    const temporaryPath = `${journalPath}.restore-${process.pid}`
    const handle = await open(temporaryPath, 'w')
    try {
      await handle.write(records.map((record) => `${JSON.stringify(record)}\n`).join(''))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, journalPath)
    return EvidenceJournal.open(journalPath)
  }

  all(): readonly EvidenceRecord[] {
    return this.records
  }

  headHash(): string {
    return this.records.at(-1)?.hash ?? GENESIS_HASH
  }

  append(type: EvidenceType, data: Record<string, unknown>, now: Date = new Date()): Promise<EvidenceRecord> {
    const run = async () => {
      const unhashed = {
        sequence: this.records.length + 1,
        type,
        recordedAt: now.toISOString(),
        data,
        previousHash: this.headHash(),
      }
      const record: EvidenceRecord = { ...unhashed, hash: recordHash(unhashed) }
      await appendDurably(this.journalPath, `${JSON.stringify(record)}\n`)
      this.records.push(record)
      return record
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }
}

export function keyObjectToPem(key: KeyObject, kind: 'public' | 'private'): string {
  return kind === 'public'
    ? key.export({ type: 'spki', format: 'pem' }).toString()
    : key.export({ type: 'pkcs8', format: 'pem' }).toString()
}
