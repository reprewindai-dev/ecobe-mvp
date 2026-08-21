# X402 Settlement

Atomic settlement of an x402 payment and the corresponding usage credit, so a
payer can never be charged without receiving credit and can never be credited
twice for the same on-chain transaction.

- Implementation: `src/lib/x402/settlement.ts`
- Gateway wiring: `src/lib/x402/gateway.ts`
- Tests: `src/__tests__/x402-settlement.test.ts` (`npm test`)
- Schema: `X402Settlement` in `prisma/schema.prisma`,
  migration `prisma/migrations/20260821080000_x402_settlements`

## Flow

`handleX402Request` is unchanged up to the point where the x402 protocol
settlement succeeds. It then calls `recordX402Settlement`, which performs every
write inside a single `prisma.$transaction`:

1. `X402Settlement` — the receipt: transaction hash, network, payer, route,
   price, decision frame, proof hash, credit quantity and unit.
2. `X402PaymentEvent` — status `settled`, linked to the settlement via
   `settlementId`.
3. `UsageRecord` — the credit, written only when the supplied `organizationId`
   resolves to an existing organization.

Either all three commit or none do. A rollback leaves no settlement row, so the
call is safe to retry with the same inputs.

## Idempotency

Every settlement is keyed by a deterministic receipt hash:

```
receiptHash = sha256(canonical({
  version, network, transactionHash, routePath, routeMethod, priceUsd
}))
```

`receiptHash` carries a unique index. A repeated request is detected either by
the in-transaction pre-check or, when two requests race, by the `P2002` unique
violation — in both cases the committed row is read back and returned with
`replayed: true`, and no second credit is written.

Binding the hash to route, method and price (not just the transaction hash)
means the same on-chain transaction cannot be replayed against a different or
more expensive route.

## Refusals

`recordX402Settlement` throws before opening a transaction when:

- the transaction hash is missing or blank — there would be no idempotency key,
  so the credit could be granted repeatedly;
- the credit quantity is not a positive finite number.

## Failure handling

If the ledger transaction fails after the on-chain payment settled, the gateway
records an `X402PaymentEvent` with status `settlement_failed` and
`metadata.stage = "credit_ledger"`, and returns HTTP 500 including the
transaction hash. The payment is real but uncredited, and the transaction hash
is the key used to replay the settlement once the cause is fixed.

## Response headers

| Header | Meaning |
| --- | --- |
| `x-co2router-x402` | `settled`, or `settled-replay` for an idempotent replay |
| `x-co2router-settlement-receipt` | The deterministic receipt hash |
| `x-co2router-settlement-id` | The `X402Settlement` row id |

## Credit attribution

Organization and project are read from the `x-co2router-organization-id` and
`x-co2router-project-id` request headers. An unknown organization does not fail
the settlement: the receipt is still recorded, with `creditRecorded = false`, so
the payment stays auditable and the credit can be reconciled later.

## Rollback

Reverting the code alone is safe — the gateway falls back to the previous
`X402PaymentEvent`-only path and existing settlement rows are left intact. To
revert the schema, drop the `X402PaymentEvent.settlementId` column and the
`X402Settlement` table; no existing column is modified by the migration.
