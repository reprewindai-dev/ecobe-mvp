import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeSettlementReceiptHash,
  recordX402Settlement,
  X402_SETTLEMENT_METRIC,
  X402_SETTLEMENT_UNIT,
  X402_SETTLEMENT_VERSION,
  type SettlementClient,
  type SettlementRow,
  type SettlementTransactionClient,
  type X402SettlementInput,
} from '@/lib/x402/settlement'

class UniqueViolation extends Error {
  code = 'P2002'
}

/**
 * In-memory stand-in for the Prisma client that enforces the two invariants the
 * settlement path depends on: the receiptHash unique index, and all-or-nothing
 * commit of the rows written inside one transaction.
 */
class FakeDb implements SettlementClient {
  settlements: SettlementRow[] = []
  paymentEvents: Record<string, unknown>[] = []
  usage: Record<string, unknown>[] = []
  organizations: { id: string }[] = []
  failOn: 'paymentEvent' | 'usage' | null = null
  transactionCount = 0

  x402Settlement = {
    findUnique: async ({ where }: { where: { receiptHash: string } }) =>
      this.settlements.find((row) => row.receiptHash === where.receiptHash) ?? null,
  }

  async $transaction<T>(fn: (tx: SettlementTransactionClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1
    const staged = {
      settlements: [...this.settlements],
      paymentEvents: [...this.paymentEvents],
      usage: [...this.usage],
    }

    const tx: SettlementTransactionClient = {
      x402Settlement: {
        findUnique: async ({ where }) =>
          staged.settlements.find((row) => row.receiptHash === where.receiptHash) ?? null,
        create: async ({ data }) => {
          if (staged.settlements.some((row) => row.receiptHash === data.receiptHash)) {
            throw new UniqueViolation('Unique constraint failed on the fields: (`receiptHash`)')
          }
          const row: SettlementRow = {
            id: `stl_${staged.settlements.length + 1}`,
            receiptHash: String(data.receiptHash),
            transactionHash: String(data.transactionHash),
            network: (data.network as string | null) ?? null,
            payer: (data.payer as string | null) ?? null,
            priceUsd: Number(data.priceUsd),
            creditQuantity: Number(data.creditQuantity),
            creditUnit: String(data.creditUnit),
            organizationId: (data.organizationId as string | null) ?? null,
            creditRecorded: Boolean(data.creditRecorded),
            createdAt: new Date('2026-08-21T07:20:58.297Z'),
          }
          staged.settlements.push(row)
          return row
        },
      },
      x402PaymentEvent: {
        create: async ({ data }) => {
          if (this.failOn === 'paymentEvent') throw new Error('payment event write failed')
          staged.paymentEvents.push(data)
          return { id: `evt_${staged.paymentEvents.length}` }
        },
      },
      organization: {
        findUnique: async ({ where }) => this.organizations.find((org) => org.id === where.id) ?? null,
      },
      usageRecord: {
        create: async ({ data }) => {
          if (this.failOn === 'usage') throw new Error('usage write failed')
          staged.usage.push(data)
          return { id: `use_${staged.usage.length}` }
        },
      },
    }

    const result = await fn(tx)
    this.settlements = staged.settlements
    this.paymentEvents = staged.paymentEvents
    this.usage = staged.usage
    return result
  }
}

function input(overrides: Partial<X402SettlementInput> = {}): X402SettlementInput {
  return {
    routeId: 'route',
    routePath: '/x402/v1/route',
    routeMethod: 'POST',
    priceUsd: 0.01,
    payer: '0xpayer',
    transactionHash: '0xtx-1',
    network: 'base-sepolia',
    decisionFrameId: 'frame-1',
    proofHash: 'sha256:abc',
    upstreamStatus: 200,
    userAgent: 'agent/1.0',
    organizationId: null,
    projectId: null,
    creditQuantity: 1,
    metadata: { routeId: 'route' },
    ...overrides,
  }
}

test('receipt hash is deterministic and binds transaction to the paid route', () => {
  const base = {
    network: 'base-sepolia',
    transactionHash: '0xtx-1',
    routePath: '/x402/v1/route',
    routeMethod: 'POST',
    priceUsd: 0.01,
  }

  assert.equal(computeSettlementReceiptHash(base), computeSettlementReceiptHash({ ...base }))
  assert.notEqual(
    computeSettlementReceiptHash(base),
    computeSettlementReceiptHash({ ...base, routePath: '/x402/v1/authorize' }),
  )
  assert.notEqual(computeSettlementReceiptHash(base), computeSettlementReceiptHash({ ...base, priceUsd: 0.04 }))
})

test('settlement writes payment and credit in one transaction', async () => {
  const db = new FakeDb()
  db.organizations.push({ id: 'org-1' })

  const receipt = await recordX402Settlement(input({ organizationId: 'org-1', projectId: 'proj-1' }), db)

  assert.equal(receipt.version, X402_SETTLEMENT_VERSION)
  assert.equal(receipt.replayed, false)
  assert.equal(receipt.creditRecorded, true)
  assert.equal(receipt.creditUnit, X402_SETTLEMENT_UNIT)
  assert.equal(db.transactionCount, 1)
  assert.equal(db.settlements.length, 1)
  assert.equal(db.paymentEvents.length, 1)
  assert.equal(db.usage.length, 1)
  assert.equal(db.usage[0].metric, X402_SETTLEMENT_METRIC)
  assert.equal(db.usage[0].amountUsd, 0.01)
  assert.equal(db.paymentEvents[0].settlementId, receipt.settlementId)
})

test('replaying the same payment does not double-credit', async () => {
  const db = new FakeDb()
  db.organizations.push({ id: 'org-1' })

  const first = await recordX402Settlement(input({ organizationId: 'org-1' }), db)
  const second = await recordX402Settlement(input({ organizationId: 'org-1' }), db)

  assert.equal(first.replayed, false)
  assert.equal(second.replayed, true)
  assert.equal(second.receiptHash, first.receiptHash)
  assert.equal(second.settlementId, first.settlementId)
  assert.equal(db.settlements.length, 1)
  assert.equal(db.usage.length, 1)
  assert.equal(db.paymentEvents.length, 1)
})

test('a concurrent winner is returned instead of a duplicate row', async () => {
  const db = new FakeDb()
  const committed = await recordX402Settlement(input(), db)

  // Simulate losing the race: the pre-check sees nothing, the insert conflicts.
  const racingDb: SettlementClient = {
    x402Settlement: db.x402Settlement,
    $transaction: async (fn) =>
      fn({
        x402Settlement: {
          findUnique: async () => null,
          create: async () => {
            throw new UniqueViolation('duplicate receiptHash')
          },
        },
        x402PaymentEvent: { create: async () => ({ id: 'evt' }) },
        organization: { findUnique: async () => null },
        usageRecord: { create: async () => ({ id: 'use' }) },
      }),
  }

  const raced = await recordX402Settlement(input(), racingDb)

  assert.equal(raced.replayed, true)
  assert.equal(raced.settlementId, committed.settlementId)
  assert.equal(db.settlements.length, 1)
})

test('a failed credit write rolls back the payment record', async () => {
  const db = new FakeDb()
  db.organizations.push({ id: 'org-1' })
  db.failOn = 'usage'

  await assert.rejects(
    () => recordX402Settlement(input({ organizationId: 'org-1' }), db),
    /usage write failed/,
  )

  assert.equal(db.settlements.length, 0)
  assert.equal(db.paymentEvents.length, 0)
  assert.equal(db.usage.length, 0)
})

test('a failed payment-event write rolls back the settlement', async () => {
  const db = new FakeDb()
  db.failOn = 'paymentEvent'

  await assert.rejects(() => recordX402Settlement(input(), db), /payment event write failed/)

  assert.equal(db.settlements.length, 0)
  assert.equal(db.paymentEvents.length, 0)
})

test('an unknown organization settles without inventing a credit owner', async () => {
  const db = new FakeDb()

  const receipt = await recordX402Settlement(input({ organizationId: 'org-missing', projectId: 'proj-1' }), db)

  assert.equal(receipt.organizationId, null)
  assert.equal(receipt.creditRecorded, false)
  assert.equal(db.usage.length, 0)
  assert.equal(db.settlements.length, 1)
})

test('settlement refuses inputs it cannot make idempotent', async () => {
  const db = new FakeDb()

  await assert.rejects(() => recordX402Settlement(input({ transactionHash: '  ' }), db), /transaction hash/)
  await assert.rejects(() => recordX402Settlement(input({ creditQuantity: 0 }), db), /positive credit quantity/)
  assert.equal(db.transactionCount, 0)
})
