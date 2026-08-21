import { createHash } from 'crypto'

import { prisma } from '@/lib/prisma'

export const X402_SETTLEMENT_VERSION = 'x402-settlement-v1'
export const X402_SETTLEMENT_METRIC = 'x402_settled_call'
export const X402_SETTLEMENT_UNIT = 'call'

export interface X402SettlementInput {
  routeId: string | null
  routePath: string
  routeMethod: string
  priceUsd: number
  payer: string | null
  transactionHash: string
  network: string | null
  decisionFrameId: string | null
  proofHash: string | null
  upstreamStatus: number | null
  userAgent: string | null
  organizationId: string | null
  projectId: string | null
  creditQuantity: number
  metadata: Record<string, unknown>
}

export interface X402SettlementReceipt {
  version: string
  settlementId: string
  receiptHash: string
  transactionHash: string
  network: string | null
  payer: string | null
  priceUsd: number
  creditQuantity: number
  creditUnit: string
  organizationId: string | null
  creditRecorded: boolean
  replayed: boolean
  settledAt: string
}

/**
 * Transaction-capable subset of the Prisma client. Injectable so the settlement
 * invariants can be exercised without a live database.
 */
export interface SettlementClient {
  $transaction<T>(fn: (tx: SettlementTransactionClient) => Promise<T>): Promise<T>
  x402Settlement: {
    findUnique(args: { where: { receiptHash: string } }): Promise<SettlementRow | null>
  }
}

export interface SettlementTransactionClient {
  x402Settlement: {
    findUnique(args: { where: { receiptHash: string } }): Promise<SettlementRow | null>
    create(args: { data: Record<string, unknown> }): Promise<SettlementRow>
  }
  x402PaymentEvent: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
  organization: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>
  }
  usageRecord: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
}

export interface SettlementRow {
  id: string
  receiptHash: string
  transactionHash: string
  network: string | null
  payer: string | null
  priceUsd: number
  creditQuantity: number
  creditUnit: string
  organizationId: string | null
  creditRecorded: boolean
  createdAt: Date
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

/**
 * Identity of a settlement: the on-chain transaction plus the resource it paid
 * for. Replaying the same payment against the same route yields the same hash,
 * which the unique index turns into an idempotent no-op.
 */
export function computeSettlementReceiptHash(input: {
  network: string | null
  transactionHash: string
  routePath: string
  routeMethod: string
  priceUsd: number
}): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        version: X402_SETTLEMENT_VERSION,
        network: input.network,
        transactionHash: input.transactionHash,
        routePath: input.routePath,
        routeMethod: input.routeMethod,
        priceUsd: input.priceUsd,
      }),
    )
    .digest('hex')
}

function toReceipt(row: SettlementRow, replayed: boolean): X402SettlementReceipt {
  return {
    version: X402_SETTLEMENT_VERSION,
    settlementId: row.id,
    receiptHash: row.receiptHash,
    transactionHash: row.transactionHash,
    network: row.network,
    payer: row.payer,
    priceUsd: row.priceUsd,
    creditQuantity: row.creditQuantity,
    creditUnit: row.creditUnit,
    organizationId: row.organizationId,
    creditRecorded: row.creditRecorded,
    replayed,
    settledAt: row.createdAt.toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

/**
 * Records a settled x402 payment and the matching usage credit in one database
 * transaction. Either both land or neither does, so a payment can never be
 * captured without its credit and a credit can never exist without its payment.
 */
export async function recordX402Settlement(
  input: X402SettlementInput,
  db: SettlementClient = prisma as unknown as SettlementClient,
): Promise<X402SettlementReceipt> {
  if (!input.transactionHash.trim()) {
    throw new Error('x402 settlement requires a transaction hash to be idempotent')
  }
  if (!Number.isFinite(input.creditQuantity) || input.creditQuantity <= 0) {
    throw new Error('x402 settlement requires a positive credit quantity')
  }

  const receiptHash = computeSettlementReceiptHash({
    network: input.network,
    transactionHash: input.transactionHash,
    routePath: input.routePath,
    routeMethod: input.routeMethod,
    priceUsd: input.priceUsd,
  })

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.x402Settlement.findUnique({ where: { receiptHash } })
      if (existing) {
        return toReceipt(existing, true)
      }

      const organization = input.organizationId
        ? await tx.organization.findUnique({ where: { id: input.organizationId } })
        : null

      const settlement = await tx.x402Settlement.create({
        data: {
          receiptHash,
          version: X402_SETTLEMENT_VERSION,
          routeId: input.routeId,
          routePath: input.routePath,
          routeMethod: input.routeMethod,
          priceUsd: input.priceUsd,
          payer: input.payer,
          transactionHash: input.transactionHash,
          network: input.network,
          decisionFrameId: input.decisionFrameId,
          proofHash: input.proofHash,
          organizationId: organization?.id ?? null,
          projectId: organization ? input.projectId : null,
          creditQuantity: input.creditQuantity,
          creditUnit: X402_SETTLEMENT_UNIT,
          creditRecorded: Boolean(organization),
          metadata: input.metadata,
        },
      })

      await tx.x402PaymentEvent.create({
        data: {
          routePath: input.routePath,
          routeMethod: input.routeMethod,
          status: 'settled',
          priceUsd: input.priceUsd,
          payer: input.payer,
          transactionHash: input.transactionHash,
          network: input.network,
          decisionFrameId: input.decisionFrameId,
          proofHash: input.proofHash,
          upstreamStatus: input.upstreamStatus,
          userAgent: input.userAgent,
          settlementId: settlement.id,
          metadata: { ...input.metadata, receiptHash },
        },
      })

      if (organization) {
        await tx.usageRecord.create({
          data: {
            organizationId: organization.id,
            projectId: input.projectId,
            metric: X402_SETTLEMENT_METRIC,
            quantity: input.creditQuantity,
            unit: X402_SETTLEMENT_UNIT,
            amountUsd: input.priceUsd,
          },
        })
      }

      return toReceipt(settlement, false)
    })
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error
    }
    // A concurrent request settled the same payment first; its committed row is
    // the single source of truth.
    const committed = await db.x402Settlement.findUnique({ where: { receiptHash } })
    if (!committed) {
      throw error
    }
    return toReceipt(committed, true)
  }
}
