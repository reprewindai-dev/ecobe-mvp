import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  EvidenceIntegrityError,
  EvidenceJournal,
  keyObjectToPem,
  signWitnessRoot,
  verifyWitnessedEvidence,
} from '@/lib/authority/evidence-chain'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const witnessKeys = generateKeyPairSync('ed25519')
const witnessPrivatePem = keyObjectToPem(witnessKeys.privateKey, 'private')
const trustedWitnessKeys = new Map([['witness-key-1', keyObjectToPem(witnessKeys.publicKey, 'public')]])

async function journalWithRecords() {
  const directory = await mkdtemp(path.join(tmpdir(), 'co2router-evidence-'))
  const journalPath = path.join(directory, 'evidence.jsonl')
  const journal = await EvidenceJournal.open(journalPath)
  await journal.append('decision', { decisionFrameId: 'frame-1', action: 'delay', region: 'eu-west-1' }, NOW)
  await journal.append('execution_attempt', { authorityId: 'authority-1' }, NOW)
  await journal.append('outcome', { status: 'EXECUTED', authorityId: 'authority-1' }, NOW)
  return { directory, journalPath, journal, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

test('detects an edited record when the journal is reopened', async () => {
  const fixture = await journalWithRecords()
  try {
    const raw = await readFile(fixture.journalPath, 'utf8')
    await writeFile(fixture.journalPath, raw.replace('"region":"eu-west-1"', '"region":"us-east-1"'))
    await assert.rejects(EvidenceJournal.open(fixture.journalPath), EvidenceIntegrityError)
  } finally {
    await fixture.cleanup()
  }
})

test('detects a deleted record that breaks the hash chain', async () => {
  const fixture = await journalWithRecords()
  try {
    const lines = (await readFile(fixture.journalPath, 'utf8')).trim().split('\n')
    await writeFile(fixture.journalPath, `${[lines[0], lines[2]].join('\n')}\n`)
    await assert.rejects(EvidenceJournal.open(fixture.journalPath), EvidenceIntegrityError)
  } finally {
    await fixture.cleanup()
  }
})

test('restores a deleted journal exactly from exported records and a signed witness root', async () => {
  const fixture = await journalWithRecords()
  try {
    const exported = [...fixture.journal.all()]
    const witness = signWitnessRoot(exported, 'witness-key-1', witnessPrivatePem, NOW)
    const headBefore = fixture.journal.headHash()

    await unlink(fixture.journalPath)
    await assert.rejects(access(fixture.journalPath))

    const restored = await EvidenceJournal.restore(fixture.journalPath, exported, witness, trustedWitnessKeys)
    assert.equal(restored.headHash(), headBefore)
    assert.deepEqual(restored.all(), exported)
    // The restored journal keeps chaining from the same head.
    const next = await restored.append('outcome', { status: 'VERIFIED_AFTER_RESTORE' }, NOW)
    assert.equal(next.previousHash, headBefore)
  } finally {
    await fixture.cleanup()
  }
})

test('rejects a forged witness: bad signature, untrusted key, or a corrupted head', async () => {
  const fixture = await journalWithRecords()
  try {
    const records = fixture.journal.all()
    const witness = signWitnessRoot(records, 'witness-key-1', witnessPrivatePem, NOW)

    // The VChip benchmark gate allowed a corrupted state root; this must not.
    assert.throws(
      () => verifyWitnessedEvidence(records, { ...witness, headHash: 'f'.repeat(64) }, trustedWitnessKeys),
      EvidenceIntegrityError,
    )
    const otherKeys = generateKeyPairSync('ed25519')
    const forged = signWitnessRoot(records, 'witness-key-1', keyObjectToPem(otherKeys.privateKey, 'private'), NOW)
    assert.throws(() => verifyWitnessedEvidence(records, forged, trustedWitnessKeys), EvidenceIntegrityError)
    assert.throws(() => verifyWitnessedEvidence(records, witness, new Map()), EvidenceIntegrityError)

    // A genuinely signed witness must not vouch for a different, self-consistent
    // chain of the same length (only the head check catches this).
    const other = await journalWithRecords()
    try {
      await other.journal.append('outcome', { status: 'EXECUTED', authorityId: 'authority-other' }, NOW)
      const substitute = other.journal.all().slice(1)
      const rebuilt = await EvidenceJournal.open(path.join(other.directory, 'substitute.jsonl'))
      for (const record of substitute) await rebuilt.append(record.type, record.data, NOW)
      assert.equal(rebuilt.all().length, records.length)
      assert.throws(() => verifyWitnessedEvidence(rebuilt.all(), witness, trustedWitnessKeys), EvidenceIntegrityError)
    } finally {
      await other.cleanup()
    }

    const tampered = records.map((record, index) =>
      index === 1 ? { ...record, data: { authorityId: 'authority-forged' } } : record,
    )
    await assert.rejects(
      EvidenceJournal.restore(fixture.journalPath, tampered, witness, trustedWitnessKeys),
      EvidenceIntegrityError,
    )
  } finally {
    await fixture.cleanup()
  }
})
