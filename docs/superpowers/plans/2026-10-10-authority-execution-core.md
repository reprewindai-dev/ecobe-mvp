# Authority Execution Core

Status: **core library implemented; not exposed as an MCP tool**

Date: 2026-10-10

Spec: `docs/superpowers/specs/2026-08-12-co2-router-portable-authority-design.md` (locked)

This covers the "Authority execution (grants, durable nonce store)" and "target adapters (B1/B2/C fixtures)" deferred plans from `2026-08-12-portable-mcp-foundation.md`, at library level only.

## Ordering note

Spec section 16 orders migration as: provenance/freshness envelopes (step 3) before Authority grants (step 4). Freshness enforcement is **not** implemented yet. The core below is therefore a tested library with no `EXECUTE` tool, no real target adapter, and no path that mutates customer infrastructure. `co2router.execute` must not ship until freshness envelopes (spec section 6, gates 3-4) are enforced.

## What exists (`src/lib/authority/`)

| Module | Spec | Purpose |
|---|---|---|
| `canonical.ts` | 7, 9 | Canonical JSON: UTF-16 code-unit key order, non-finite numbers rejected, `-0` normalized |
| `authority-schema.ts` | 7 | Two signed documents. **Execution intent** (requester-signed): tenant, audience, requester principal, operation, adapter, target, payload hash, optional CO2 Router decision, optional compare-and-set expectations (`expectedPreStateRoot`, `expectedGeneration`), validity window, nonce. **Authority envelope** (Authority-signed): license/tenant/audience, actor/requester, scopes, permitted adapters, target bounds, energy/cost budget, payload hash, policy hash, `intentCommitment` (hash of the exact signed intent), optional decision binding, optional B1 fencing generation, validity window, nonce |
| `authority-verifier.ts` | 7, 12 | `verifyIntent`: requester key must be trusted **and bound to the named principal**; window, tenant, and exact request match. `verifyAuthority`: Ed25519 against a local trust store; `authority` edition and `authority:execute` scope; must commit to the verified intent and name the same requester; short lifetime; adapter, target, payload, policy, decision, and budget checks. Fails closed. |
| `nonce-store.ts` | 13 | fsync'd append-only nonce journal; durable across restarts for the authority lifetime |
| `evidence-chain.ts` | 11 | Hash-chained evidence journal (`request -> authority -> execution_attempt -> target_ack -> outcome`); verification recomputes every hash and link; Ed25519-signed witness root; restore a lost journal only from records that verify against a trusted witness |
| `targets.ts` | 8 | B1 fencing fixture; durable B2 fixture with idempotency keyed on the intent and compare-and-set on state root + generation (idempotency checked first, so retries stay `DUPLICATE`); Class C autonomy rule |
| `executor.ts` | 8, 12 | verify intent -> verify authority against it -> autonomy rule -> refuse CAS expectations the adapter cannot enforce -> consume authority nonce **and** intent -> record attempt -> touch target. A re-issued authority cannot re-run an executed intent. Ambiguous responses are `UNKNOWN`, never blindly retried; explicit retries only for B2 |

## Acceptance gates covered

| Gate | Test |
|---|---|
| 5. Expired authority blocks execution | `authority-verifier`, `authority-execution` |
| 6. Altered license/authority/payload/policy/audience/expiry/signature rejected | `authority-verifier` |
| 7. Replayed nonce rejected (including after restart) | `authority-execution` |
| 8. B1 stale generation rejected | `authority-execution` |
| 9. B2 duplicate: one mutation, deterministic receipt, across restarts | `authority-execution` |
| 10. Class C cannot execute autonomously during partition | `authority-execution` |
| Two signatures: forged/foreign/mismatched intents rejected; authority approves only its committed intent; re-issued authority cannot re-run an intent | `authority-verifier`, `authority-execution` |
| Compare-and-set: stale generation or state root rejected; unenforceable expectations refused | `authority-execution` |

Each guard was checked by disabling it and confirming a test fails.

## Remaining work

1. **Freshness envelopes first** (spec 6; gates 3-4).
2. `co2router.execute` (`EXECUTE`) and `co2router.approve` (`ADMIN`) MCP tools gated on the `authority` edition.
3. Signed Authority-to-engine contract with nonce and audience (spec 9; gate 11).
4. Real adapters with declared classes. Candidates: GitHub Actions via the engine's `enforcementBundle.githubActions` (concurrency group + `notBefore`), Kubernetes admission via `k8s-policy.ts`. Each must state honestly whether the target enforces fencing (spec 8: no generic fencing claims).
5. PostgreSQL-backed nonce and evidence stores for enterprise deployments, implementing the same contract as the file stores.
6. Authority issuance flow (who signs envelopes, key rotation via the trust store).
7. Gates 1-4 and 11-14 end to end.

## Design provenance

The design ports concepts from the VChip/CAPPO prototypes (Veklom), reimplemented in TypeScript. Per spec section 15, CO2 Router takes no runtime dependency on Veklom, CAPI, or their stores. Known prototype gaps fixed here:

| Prototype gap | Here |
|---|---|
| Ghost lease and witness root unsigned (forgeable) | Authority envelope and witness root are Ed25519-signed and verified |
| Gate did not recompute the state-root chain | Every record hash and link is recomputed; witness head must match |
| Consumed operations held in memory | Durable fsync'd nonce journal |
| Issuer key regenerated on each restart | Keys come from a configured trust store |
| Sink skipped signature checks when no key was configured (fail open) | Verification is unconditional; missing trust fails closed |
| Batch budget counted operations | Single-use authority; budget bounds energy and cost |
| VirtualDB's VFRAC-1 intent/attestation and CAS fields existed only as data shapes (admission check was simulated) | Requester-signed intent + Authority commitment, and compare-and-set, implemented and enforced |

## Proof of benefit is a separate track

No measured carbon-benefit data exists today (the one captured production decision shows 0% reduction). Benefit evidence must come from live signals on real workloads, e.g. the engine GitHub Action in `mode: shadow` collecting `co2router-decision.json` records, counting only records with `fallbackUsed: false` (spec 15: no hypothetical savings described as measured evidence).
