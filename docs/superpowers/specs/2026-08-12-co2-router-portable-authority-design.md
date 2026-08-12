# CO2 Router Portable Authority Architecture

Status: **Approved and locked**

Approved: 2026-08-12

Implementation owner: `ecobe-mvp` (Authority/MCP) with `ecobe-engineclaude` (private engine)

## 1. Objective

CO2 Router is a single portable MCP product composed of `ecobe-mvp` and `ecobe-engineclaude`, with HallOGrid as an optional human interface. `co2router.com` is the product's public website, commerce, distribution, update, and optional hosted-services surface; it is not a separate product and is not a required execution dependency. The installed runtime may continue offline only within locally verifiable license, authority, policy, and signal-freshness bounds.

Purchase conveys the capability to run CO2 Router; it does not convey authority over the customer's infrastructure. Execution authority remains explicitly delegated by the customer.

This boundary is an implementation constraint. Future work must implement against it rather than reintroducing an always-online SaaS dependency or inventing a second decision engine.

## 2. Product Editions

Both editions use the same MCP server, decision engine, policy engine, proof format, and release artifact.

### CO2 Router

Permitted capabilities:

- read environmental and operational inputs;
- compare candidate regions and execution windows;
- simulate policy outcomes;
- decide `RUN`, `REROUTE`, `DELAY`, `THROTTLE`, or `DENY`;
- explain the deterministic decision path;
- create and verify evidence and replay proofs.

This edition cannot mutate customer infrastructure.

### CO2 Router Authority

Authority adds governed capability; it does not create a second engine.

- customer-configured execution adapters;
- human approval workflows;
- signed, short-lived capability grants;
- bounded offline execution authority;
- target-aware fencing, conditional mutation, and retry protection;
- enterprise evidence and audit export.

Entitlements unlock Authority features in the same codebase. Product code must not fork into independent Core and Authority implementations.

## 3. System Boundary

```text
CO2 ROUTER — one product
├── ecobe-mvp / Authority and MCP runtime
│   ├── MCP stdio
│   ├── optional MCP Streamable HTTP
│   ├── local entitlement and authority verification
│   ├── tool classification and authorization
│   ├── approval workflow
│   └── local audit/evidence store
│
├── protected HTTP boundary
│   └── signed, short-lived internal requests
│
├── ecobe-engineclaude / CO2 Router Engine
│   ├── signal evaluation
│   ├── deterministic doctrine and policy
│   ├── routing decision
│   └── evidence, provenance, proof, and replay
│
└── HallOGrid
    └── optional read-only human visibility

co2router.com — public surface for the same product
├── website and discovery metadata
├── x402 one-time acquisition
├── payment verification and settlement
├── signed entitlement issuance
├── package/container distribution
├── signed updates and optional revocation information
└── optional hosted environmental data
```

Once installed, `ecobe-mvp` and `ecobe-engineclaude` must run locally without calling `co2router.com` for a normal decision. Unavailability of the website or its hosted services must not stop a locally licensed read, comparison, simulation, decision, explanation, or proof operation that remains inside its local policy bounds.

Optional hosted data is an input provider, never an authority provider. Its absence invokes explicit degradation rules.

## 4. Runtime Responsibilities

### `ecobe-mvp` / Authority

- expose real MCP tools and return their actual results;
- support local `stdio` as the default portable transport;
- optionally expose authenticated Streamable HTTP;
- verify signed licenses locally without a network call;
- classify tools as `READ`, `SIMULATE`, `DRAFT`, `EXECUTE`, or `ADMIN`;
- authorize purchased capabilities separately from customer execution authority;
- create approval intents that freeze the action, target, payload hash, policy hash, actor, expiry, and one-time execution nonce;
- sign short-lived internal requests to the engine;
- maintain tenant-scoped audit records and evidence receipts;
- fail closed for consequential execution when authority cannot be proven.

The current `/mcp` behavior that tells a caller to invoke a separate endpoint is transitional. The finished `tools/call` path must execute the authorized operation and return its MCP result.

### `ecobe-engineclaude` / Engine

- accept requests only through the protected internal contract;
- validate internal signature, audience, expiry, request hash, nonce, and policy identity;
- evaluate carbon, water, cost, latency, reliability, and policy inputs;
- produce exactly one deterministic binding decision;
- include complete signal provenance and degradation state;
- generate tamper-evident proof and deterministic replay material;
- never process payments, issue licenses, approve actions, or expand authority.

### HallOGrid

- display decisions, provenance, degradation, proofs, approvals, and health;
- remain read-only unless a separately authenticated Authority approval interface is explicitly implemented;
- never synthesize governance, telemetry, approvals, or successful execution.

## 5. MCP Tool Contract

Initial logical tools:

```text
co2router.evaluate
co2router.compare
co2router.route
co2router.explain
co2router.proof
co2router.replay
co2router.execute       Authority only
co2router.approve       authenticated human Authority surface only
```

Tool names may be versioned during implementation, but their risk classes are fixed:

| Tool class | Base license | Customer authority required | Offline behavior |
|---|---:|---:|---|
| READ | yes | no | allowed within license and data policy |
| SIMULATE | yes | no | allowed; degradation disclosed |
| DRAFT | Authority | no mutation | draft only |
| EXECUTE | Authority | yes | only inside a valid authority envelope |
| ADMIN | Authority | explicit human admin | denied without current human authorization |

MCP annotations are descriptive only. Server-side authorization is mandatory and cannot trust client-provided annotations, roles, scopes, payment headers, or UI state.

## 6. Signal Provenance Invariant

**Signal provenance is part of the decision.** A decision is incomplete without its input provenance and freshness judgment.

Every signal used in a decision must carry:

```text
signal_source
signal_observed_at
signal_age_seconds
signal_class: LIVE | CUSTOMER_LIVE | CACHED | BUNDLED_BASELINE
confidence
freshness_policy_id
freshness_max_age_seconds
freshness_outcome: ACCEPT | DEGRADE | REJECT
degradation_state
evidence_reference
```

The decision envelope must state which signals were binding, supporting, rejected, or unavailable. Cached or bundled data must never be represented as current/live data.

Freshness is policy-specific, signal-specific, and operation-specific. For example, a policy may reject a 20-minute-old operational carbon signal for execution while accepting it for a 24-hour structural comparison. The policy hash and exact threshold used must be recorded in the proof.

When required evidence is outside its freshness envelope:

- `READ` may return historical data with provenance;
- `SIMULATE` may continue with explicit degradation;
- a decision may become `DELAY` or `DENY` according to policy;
- consequential execution must not silently proceed using stale data.

## 7. Locally Verifiable License and Authority

### License envelope

A signed license establishes product capability, not infrastructure authority. It must include at least:

```text
license_id
product_edition
customer_or_tenant
installation_or_audience
capability_scopes
issued_at
not_before
expires_at_or_perpetual_version_scope
major_version_bounds
issuer_key_id
signature_algorithm
signature
```

The verifier uses an embedded or locally configured issuer trust store. Key rotation must support overlapping trusted keys and signed key-set updates. A network revocation check may be offered but cannot be mandatory for ordinary perpetual-license use unless the customer's contract explicitly selects an online-managed license.

### Authority envelope

Consequential execution requires a separate signed envelope containing at least:

```text
authority_id
license_id
customer_or_tenant
installation_or_audience
actor_and_requester
capability_scopes
permitted_execution_adapters
target_resource_bounds
budget_bounds
approval_policy
payload_hash
policy_hash
issued_at
not_before
expires_at
nonce
issuer_key_id
signature
```

Authority is short-lived and non-transferable. It cannot be extended, widened, renewed, or self-issued while disconnected.

If authority expires offline:

- historical reads may continue if the license permits;
- simulation may continue if the license and signal policy permit;
- new consequential execution is blocked;
- pending approval grants expire to deny;
- previously authorized retries follow their recorded idempotency and fencing rules only.

## 8. Target-Aware Execution Safety

Authority must classify every execution adapter before enabling autonomous mutation:

### Class B1 — target supports fencing

- pass a monotonically increasing writer generation/fencing token;
- require the target to persist and compare that token;
- reject a generation that is not strictly newer;
- record target acknowledgment in the execution receipt.

### Class B2 — target supports idempotency or conditional mutation

- bind an idempotency key to the authority ID and payload hash;
- use target-native compare-and-set, ETag/version, or idempotency semantics;
- define exact retry count, expiry, and terminal outcome;
- never reinterpret an ambiguous response as success.

### Class C — target supports neither

- no autonomous execution during a partition or ambiguous connectivity;
- require current human authorization and confirmed connectivity;
- default to read/simulate/draft only.

CO2 Router must not claim generic fencing protection for an external system that does not enforce the token. Database fencing protects database writes only; it does not automatically fence cloud APIs, schedulers, or physical systems.

## 9. HTTP Authority-to-Engine Contract

The local process boundary remains HTTP even when both services ship in one container bundle/private network.

Each internal request must include or cryptographically bind:

- request ID and one-time nonce;
- Authority installation and audience;
- tenant/license context;
- action and risk class;
- exact payload hash;
- policy hash;
- issued-at and expiry;
- approval/authority reference where required;
- signature and issuer key ID.

The engine rejects missing, expired, replayed, audience-mismatched, payload-mismatched, or incorrectly signed requests. Network location alone is not authentication.

## 10. Commerce and Distribution

x402 is used initially for one-time capability acquisition, not mandatory per-call local metering:

```text
discover → HTTP 402 challenge → signed payment → verify/settle
→ signed entitlement → obtain package → verify and run locally
```

ACK-Pay/Verifiable Credential receipts may be supported as an additional receipt format, but they are not inherent x402 output and are not required for the first release. Nevermined card delegation is a provider-specific draft option, not a core x402 guarantee.

Canonical distribution order:

1. signed container/Compose bundle containing Authority and Engine;
2. signed npm package and `npx` launcher for local MCP stdio;
3. MCP Registry metadata after the package is independently installable;
4. optional thin clients for other languages—never a second decision engine.

The MCP Registry is a discovery channel, not the package host or a runtime dependency.

## 11. Local State and Evidence

The portable runtime owns its local configuration, cache, approvals, audit, and proof store. The storage implementation may be PostgreSQL for enterprise deployment and a documented embedded option for a single-node edition, provided both implement the same evidence contract.

Evidence is described as **signed and tamper-evident**, not immutable, unless a deployment actually enforces append-only storage or external anchoring. Every proof must identify its storage and integrity guarantees.

Required evidence links:

```text
request → license → authority/approval → policy → signals
→ decision → execution attempt → target acknowledgment → outcome
```

## 12. Failure and Degradation Rules

- `co2router.com` and its commerce/update services unavailable: licensed local decisions continue.
- Optional hosted data unavailable: use customer-live, cached, or bundled inputs only under policy; disclose degradation.
- License cannot be verified: deny product capabilities except non-sensitive diagnostics.
- Authority missing/expired: read and simulate only as licensed; block execution.
- Approval service unavailable: pending approvals expire to deny.
- Engine unavailable: return explicit unavailable/degraded state; never synthesize a decision.
- Audit write failure: block consequential execution unless a configured append-only emergency journal durably accepts the event.
- Ambiguous target response: record unknown outcome and prevent blind retry.
- Clock uncertainty beyond configured tolerance: reject time-bounded authority and freshness-sensitive execution.

## 13. Security Constraints

- deny by default;
- no public path directly to the engine;
- no secret embedded in a distributable image;
- separate license verification from execution authorization;
- tenant/object authorization on every access;
- payload-bound, short-lived, one-time approval grants;
- replay cache durable enough for the authority lifetime;
- local HTTP binds to loopback/private network and validates origin where applicable;
- Streamable HTTP requires authentication, TLS at the exposed boundary, origin validation, request limits, and session isolation;
- signed release artifacts and reproducible version metadata;
- no self-assigned operator/admin roles;
- no fake telemetry, approvals, payments, settlement, or proof.

## 14. Verification and Acceptance

The architecture is not complete until automated evidence proves:

1. A licensed local `stdio` MCP client can execute read/simulate/decision tools with CO2Router.com unreachable.
2. `tools/call` returns the actual engine result, not instructions to call another endpoint.
3. Cached and bundled signals cannot appear as `LIVE`.
4. Different policy freshness limits deterministically produce different outcomes for the same signal age.
5. Expired offline authority blocks new execution while permitted historical reads/simulations continue.
6. Altering license, authority, payload, policy, audience, expiry, or signature causes rejection.
7. A replayed nonce is rejected.
8. A B1 stale generation is rejected by the target fixture.
9. A B2 duplicate request produces one target mutation and a deterministic receipt.
10. A Class C target cannot execute autonomously during partition.
11. Engine direct-public-access tests fail closed.
12. Commerce, Registry, and hosted-data outages do not enter the normal local decision path.
13. Proof/replay reproduces the decision from the recorded policy and evidence bundle.
14. Package, container, SBOM, signatures, license notices, and security audit pass release gates.

## 15. Explicit Non-Goals

- mandatory hosted authentication for every tool call;
- per-call x402 payment for ordinary local operation;
- a Python rewrite or duplicate engine;
- dependence on CAPI/VEKLM runtime, database, identity, or deployment;
- generic autonomous writes to unfenceable targets;
- claiming regulatory compliance solely because an audit export exists;
- describing hypothetical savings, adoption, funding eligibility, or market demand as measured evidence.

## 16. Repository and Migration Rule

`ecobe-mvp` evolves into the portable Authority/MCP component of CO2 Router. Website, commerce, distribution, update, and optional hosted-service code may be deployed separately for operational reasons, but all remain surfaces of the same CO2 Router product and local MCP execution must remain self-contained. `ecobe-engineclaude` remains the single protected deterministic engine.

Migration must be incremental:

1. establish shared signed contracts and real MCP execution;
2. establish local entitlement verification and offline tests;
3. enforce provenance/freshness envelopes;
4. add Authority grants and target classifications;
5. remove `co2router.com` and optional hosted services from the local hot path;
6. package and sign the portable release;
7. publish discovery metadata only after installation and offline operation are proven.

No phase may reintroduce fake governance, an always-online entitlement check, paid infrastructure as a core requirement, a nested legacy engine, or a second routing implementation.
