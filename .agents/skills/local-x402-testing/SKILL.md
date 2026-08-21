---
name: local-x402-testing
description: Run the ecobe-mvp Next.js app locally against a real Postgres and exercise the x402 gateway/settlement ledger without faking payments.
---

# Local x402 / settlement testing (ecobe-mvp)

## Database
```bash
docker run -d --name pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -p 5432:5432 postgres:16
docker exec pg-test psql -U postgres -c "CREATE DATABASE ecobe_platform;"
```
`.env`: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ecobe_platform?schema=mvp` (plus
`DIRECT_DATABASE_URL`). Then `npx prisma migrate deploy` (all migrations apply on an empty DB) and
`npx prisma migrate status` to confirm.

Standalone scripts run with `npx tsx scripts/<file>.ts` do NOT auto-load `.env` for Prisma — prefix
the command with `DATABASE_URL=...` explicitly.

## Booting the x402 route surface
`x402GatewayConfigured()` requires `CO2ROUTER_X402_ENABLED` (default true) and `CO2ROUTER_PAY_TO`
(any EVM address works for the challenge path). Important: the default network `eip155:8453`
(Base mainnet) is NOT supported by the public facilitator `https://x402.org/facilitator`, so route
registration fails and every `/x402/v1/*` call 500s with `missing_facilitator`. Use the testnet:

```
CO2ROUTER_X402_ENABLED=true
CO2ROUTER_PAY_TO=0x000000000000000000000000000000000000dEaD
CO2ROUTER_X402_NETWORK=eip155:84532
```

Check what the facilitator supports with `curl https://x402.org/facilitator/supported`.
`npx next dev -p 3005`, then `POST /x402/v1/route` with no payment header returns HTTP 402 and
`{"error":"x402 payment required", ...}` — this proves the gateway/route surface without paying.

## What cannot be tested locally
A settled payment requires a funded base-sepolia wallet plus a client that signs a valid
`PAYMENT-SIGNATURE`/`X-PAYMENT` header. Without those credentials, do not fake a payment. Instead
drive `recordX402Settlement` directly against the real Postgres (repo law: no mocked Prisma):
call it twice with identical input (expect `replayed:false` then `replayed:true`, one settlement,
one payment event, one usage record).

To force a mid-transaction failure without stubbing, install a real Postgres trigger and drop it after:
```sql
CREATE OR REPLACE FUNCTION mvp.fail_usage_insert() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'forced usage ledger failure'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER fail_usage BEFORE INSERT ON mvp."UsageRecord"
FOR EACH ROW EXECUTE FUNCTION mvp.fail_usage_insert();
```
The settlement call then throws and leaves zero X402Settlement / X402PaymentEvent rows.

## Housekeeping
`next dev` regenerates `AGENTS.md`, `CLAUDE.md` and touches `next-env.d.ts` — delete/restore them
before reporting so the working tree stays clean.

## Devin Secrets Needed
None for the above. Real end-to-end paid settlement would need a funded base-sepolia wallet key
(e.g. `X402_TEST_PAYER_PRIVATE_KEY`) and optionally `CO2ROUTER_X402_FACILITATOR_BEARER_TOKEN`.
