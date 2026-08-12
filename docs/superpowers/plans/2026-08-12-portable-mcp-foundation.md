# Portable MCP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure CO2 Router MCP runtime that executes real read/simulate/decision tools, verifies a signed entitlement locally, and proves that ordinary local decisions do not call `co2router.com`.

**Architecture:** `ecobe-mvp` owns MCP transport, local entitlement verification, tool authorization, and the protected HTTP call to `ecobe-engineclaude`. The existing hosted x402 routes remain acquisition surfaces but are removed from the local MCP hot path. This plan establishes only non-mutating portable capabilities; consequential Authority execution is a later independently reviewed plan.

**Tech Stack:** TypeScript, Node.js 22, Next.js 16, `@modelcontextprotocol/sdk`, Zod, Node `crypto` Ed25519 verification, Node test runner through `tsx`, protected HTTP to `ecobe-engineclaude`.

## Global Constraints

- CO2 Router is one product composed of `ecobe-mvp`, `ecobe-engineclaude`, and optional HallOGrid.
- `co2router.com` must not be called during a normal installed routing decision.
- Purchase grants product capability, never customer infrastructure authority.
- This phase exposes only `READ` and `SIMULATE`/decision capabilities; no infrastructure mutation.
- Cached or bundled signals must never be represented as live.
- The engine remains private and cannot issue licenses, approve actions, or expand authority.
- No paid API or always-online entitlement service may be required.
- No Python rewrite, duplicate engine, CAPI runtime dependency, fake telemetry, or fake payment state.
- All implementation follows test-first red/green cycles and ends with a clean commit.

---

## File Structure

### New files

- `src/lib/license/license-schema.ts` — strict signed-license and verified-entitlement types.
- `src/lib/license/license-verifier.ts` — canonical payload serialization, Ed25519 verification, audience/time/version/scope checks.
- `src/lib/license/license-loader.ts` — loads a license and trust keys from explicit local file paths.
- `src/lib/mcp/tool-catalog.ts` — immutable MCP tool definitions, risk classes, scopes, and engine mappings.
- `src/lib/mcp/tool-executor.ts` — validates arguments, verifies scope, invokes the protected engine, and normalizes MCP output.
- `src/lib/mcp/server-factory.ts` — constructs one MCP server used by stdio and Streamable HTTP transports.
- `src/cli/co2router-mcp.ts` — local stdio executable; logs only to stderr.
- `src/__tests__/license-verifier.test.ts` — license signature and constraint tests.
- `src/__tests__/mcp-tool-executor.test.ts` — actual execution, scope, and no-hosted-hot-path tests.
- `src/__tests__/mcp-protocol.test.ts` — initialize/list/call protocol tests against an in-memory transport.
- `scripts/generate-development-license.ts` — explicit local-only key/license generator; never used in production startup.

### Modified files

- `package.json` / `package-lock.json` — patched runtime, MCP SDK, executable, and test scripts.
- `next.config.js` — fail builds on TypeScript errors and remove obsolete ignored lint/build settings.
- `.env.example` — local license/trust paths and engine boundary settings without secrets.
- `src/lib/env.ts` — portable-runtime file paths, audience, version, and fail-closed production defaults.
- `src/app/mcp/route.ts` — standards-based Streamable HTTP adapter using the same server factory.
- `README.md` — truthful installation, offline behavior, and remaining limitations.
- `.github/workflows/ci.yml` — test, type-check, build, audit, and offline-hot-path gates.

---

### Task 1: Security and Test Baseline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.js`
- Modify: `.github/workflows/ci.yml`
- Create: `src/__tests__/baseline.test.ts`

**Interfaces:**
- Consumes: existing Next.js application and TypeScript configuration.
- Produces: `npm test`, strict `npm run type-check`, strict `npm run build`, and `npm run audit:production` release gates.

- [ ] **Step 1: Add a failing baseline test and scripts**

Create `src/__tests__/baseline.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import nextConfig from '../../next.config.js'

test('production build never ignores TypeScript errors', () => {
  assert.notEqual(nextConfig.typescript?.ignoreBuildErrors, true)
})
```

Add scripts:

```json
{
  "test": "tsx --test src/__tests__/*.test.ts",
  "audit:production": "npm audit --omit=dev --audit-level=high"
}
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `npm test`

Expected: FAIL because `ignoreBuildErrors` is currently `true`.

- [ ] **Step 3: Patch the runtime and enforce strict builds**

Set exact compatible versions:

```json
{
  "next": "16.3.0",
  "react": "19.2.8",
  "react-dom": "19.2.8",
  "@types/react": "19.2.2",
  "@types/react-dom": "19.2.2",
  "eslint-config-next": "16.3.0"
}
```

Replace `next.config.js` with:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
}

module.exports = nextConfig
```

Update CI to run, in order:

```yaml
- run: npm ci
- run: npm test
- run: npm run type-check
- run: npm run build
- run: npm run audit:production
```

- [ ] **Step 4: Verify baseline gates**

Run: `npm test && npm run type-check && npm run build && npm run audit:production`

Expected: all commands exit `0`; audit reports no high/critical production vulnerabilities.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.js .github/workflows/ci.yml src/__tests__/baseline.test.ts
git commit -m "security: establish portable runtime release gates"
```

---

### Task 2: Locally Verifiable Signed Entitlement

**Files:**
- Create: `src/lib/license/license-schema.ts`
- Create: `src/lib/license/license-verifier.ts`
- Create: `src/lib/license/license-loader.ts`
- Create: `src/__tests__/license-verifier.test.ts`
- Create: `scripts/generate-development-license.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: a JSON license, PEM Ed25519 public keys, current time, installed product version, and installation audience.
- Produces: `verifyLicense(input: VerifyLicenseInput): VerifiedEntitlement` and `loadLocalEntitlement(): Promise<VerifiedEntitlement>`.

- [ ] **Step 1: Define strict types and failing signature tests**

Define:

```ts
export const LicensePayloadSchema = z.object({
  licenseId: z.string().min(1),
  product: z.literal('co2-router'),
  edition: z.enum(['router', 'authority']),
  customerOrTenant: z.string().min(1),
  audience: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  issuedAt: z.string().datetime(),
  notBefore: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  majorVersionMin: z.number().int().positive(),
  majorVersionMax: z.number().int().positive(),
  issuerKeyId: z.string().min(1),
}).strict()

export const SignedLicenseSchema = z.object({
  payload: LicensePayloadSchema,
  algorithm: z.literal('Ed25519'),
  signature: z.string().min(1),
}).strict()
```

Tests must generate an ephemeral Ed25519 pair and assert valid verification plus rejection of modified scope, audience mismatch, future `notBefore`, expired license, unknown key, and incompatible major version.

- [ ] **Step 2: Run focused tests and verify the red state**

Run: `npx tsx --test src/__tests__/license-verifier.test.ts`

Expected: FAIL because `verifyLicense` does not exist.

- [ ] **Step 3: Implement canonical verification**

Expose:

```ts
export type VerifyLicenseInput = {
  signedLicense: unknown
  trustedPublicKeys: ReadonlyMap<string, string>
  expectedAudience: string
  productMajorVersion: number
  now?: Date
}

export function verifyLicense(input: VerifyLicenseInput): VerifiedEntitlement
```

Canonicalize payload keys recursively before `JSON.stringify`, decode the base64url signature, and call Node `verify(null, payloadBytes, createPublicKey(pem), signature)`. Reject before returning if schema, signature, audience, time, version, or key constraints fail. Do not fetch keys or revocation state.

- [ ] **Step 4: Implement explicit local loading**

Add environment values:

```ts
CO2ROUTER_LICENSE_FILE
CO2ROUTER_TRUST_STORE_FILE
CO2ROUTER_INSTALLATION_ID
CO2ROUTER_PRODUCT_MAJOR_VERSION
```

`loadLocalEntitlement` reads only those local files. Production startup with missing paths must fail closed. Development generation must require an explicit command and write only to a caller-selected directory.

- [ ] **Step 5: Verify license tests and full gates**

Run: `npm test && npm run type-check`

Expected: all license mutation/expiry/audience tests pass and type-check exits `0`.

- [ ] **Step 6: Commit**

```bash
git add .env.example src/lib/env.ts src/lib/license src/__tests__/license-verifier.test.ts scripts/generate-development-license.ts
git commit -m "feat: verify CO2 Router entitlements locally"
```

---

### Task 3: One Typed MCP Tool Catalog

**Files:**
- Create: `src/lib/mcp/tool-catalog.ts`
- Create: `src/__tests__/mcp-tool-catalog.test.ts`
- Modify: `src/lib/x402/mcp.ts`

**Interfaces:**
- Consumes: no runtime services.
- Produces: `CO2_ROUTER_TOOLS`, `getToolDefinition(name)`, and shared schemas used by local MCP and x402 discovery.

- [ ] **Step 1: Write catalog contract tests**

Assert every tool has a unique name, scope, risk class, Zod input schema, MCP JSON schema, engine method/path builder, and `mutatesInfrastructure: false` in this phase. Assert x402 discovery derives descriptions/schemas from the same definitions rather than maintaining a second catalog.

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `npx tsx --test src/__tests__/mcp-tool-catalog.test.ts`

Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Implement the catalog**

Use this interface:

```ts
export type ToolRiskClass = 'READ' | 'SIMULATE'

export type Co2RouterToolDefinition<T> = {
  name: string
  title: string
  description: string
  requiredScope: string
  riskClass: ToolRiskClass
  mutatesInfrastructure: false
  input: z.ZodType<T>
  inputJsonSchema: Record<string, unknown>
  engineRequest: (input: T) => {
    method: 'GET' | 'POST'
    path: string
    body?: unknown
  }
}
```

Initial tools:

```text
co2router_route     scope route:simulate  POST ci/route
co2router_explain   scope proof:read      GET decision replay/proof path
co2router_proof     scope proof:read      GET decision proof path
co2router_replay    scope replay:read     GET decision replay path
```

- [ ] **Step 4: Remove catalog duplication**

Make `src/lib/x402/mcp.ts` map the shared catalog for overlapping tools. Hosted pricing remains x402 metadata and must not enter local tool authorization.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run type-check`

```bash
git add src/lib/mcp/tool-catalog.ts src/lib/x402/mcp.ts src/__tests__/mcp-tool-catalog.test.ts
git commit -m "refactor: define one CO2 Router MCP tool catalog"
```

---

### Task 4: Real Tool Execution Through the Protected Engine

**Files:**
- Create: `src/lib/mcp/tool-executor.ts`
- Create: `src/__tests__/mcp-tool-executor.test.ts`
- Modify: `src/lib/x402/upstream.ts` or extract its protected engine client into `src/lib/engine/engine-client.ts`

**Interfaces:**
- Consumes: `VerifiedEntitlement`, tool name/arguments, and injected `EngineTransport`.
- Produces: `executeMcpTool(input: ExecuteMcpToolInput): Promise<CallToolResult>`.

- [ ] **Step 1: Write executor tests with an injected engine fake**

Test that the executor:

- rejects unknown tools;
- rejects missing scopes;
- rejects malformed input;
- calls the mapped engine path once;
- returns actual JSON content and structured content;
- returns `isError: true` for engine 4xx/5xx without claiming success;
- never calls a hosted URL.

Use an `EngineTransport` fake that records URLs and throw if a hostname equals or ends in `co2router.com`.

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `npx tsx --test src/__tests__/mcp-tool-executor.test.ts`

Expected: FAIL because `executeMcpTool` does not exist.

- [ ] **Step 3: Implement the injected boundary**

```ts
export type EngineTransport = {
  request(input: {
    method: 'GET' | 'POST'
    path: string
    body?: unknown
    requestId: string
  }): Promise<{ status: number; body: unknown }>
}

export type ExecuteMcpToolInput = {
  name: string
  arguments: unknown
  entitlement: VerifiedEntitlement
  engine: EngineTransport
}
```

Validate scope and arguments before engine I/O. The concrete engine client must construct its target exclusively from `ECOBE_ENGINE_URL`, reject non-loopback/non-private HTTP in production unless HTTPS, attach internal authentication, apply a timeout, and never fall back to a public CO2 Router hostname.

- [ ] **Step 4: Verify the hot-path invariant**

Run: `npx tsx --test src/__tests__/mcp-tool-executor.test.ts`

Expected: PASS including the explicit no-`co2router.com` assertion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tool-executor.ts src/lib/engine src/lib/x402/upstream.ts src/__tests__/mcp-tool-executor.test.ts
git commit -m "feat: execute MCP tools through the private engine"
```

---

### Task 5: Standards-Based MCP Stdio and Streamable HTTP

**Files:**
- Create: `src/lib/mcp/server-factory.ts`
- Create: `src/cli/co2router-mcp.ts`
- Create: `src/__tests__/mcp-protocol.test.ts`
- Modify: `src/app/mcp/route.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `loadLocalEntitlement`, `executeMcpTool`, and concrete `EngineTransport`.
- Produces: `createCo2RouterMcpServer(dependencies)`, an npm `bin` named `co2router-mcp`, stdio transport, and authenticated Streamable HTTP route.

- [ ] **Step 1: Add MCP SDK and write protocol tests**

Install an exact reviewed `@modelcontextprotocol/sdk` release. Using the SDK in-memory transport, test:

- `initialize` negotiates a supported protocol version;
- `tools/list` exposes the shared catalog;
- `tools/call` invokes the executor and returns actual engine output;
- an invalid license prevents tool calls;
- no stdout log corrupts stdio framing.

- [ ] **Step 2: Verify the red state**

Run: `npx tsx --test src/__tests__/mcp-protocol.test.ts`

Expected: FAIL because `createCo2RouterMcpServer` does not exist.

- [ ] **Step 3: Implement one server factory**

Create one SDK `Server`/`McpServer` instance factory that registers list/call behavior from `CO2_ROUTER_TOOLS`. Dependencies are injected so tests never need a database, network, or hosted service.

- [ ] **Step 4: Implement stdio**

`src/cli/co2router-mcp.ts` must:

```ts
const entitlement = await loadLocalEntitlement()
const server = createCo2RouterMcpServer({ entitlement, engine: createEngineTransport() })
await server.connect(new StdioServerTransport())
```

It may log diagnostics only to stderr and must exit non-zero if license verification or engine configuration fails.

- [ ] **Step 5: Replace the transitional `/mcp` route**

Use the SDK Streamable HTTP transport with session isolation, origin validation, request-size limit, and local entitlement verification. Remove the instructional `tools/call` response entirely.

- [ ] **Step 6: Verify protocol and production gates**

Run: `npm test && npm run type-check && npm run build`

Expected: protocol tests pass and the Next.js production build exits `0` without ignored type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/lib/mcp/server-factory.ts src/cli/co2router-mcp.ts src/app/mcp/route.ts src/__tests__/mcp-protocol.test.ts
git commit -m "feat: ship real CO2 Router MCP transports"
```

---

### Task 6: Offline Acceptance Harness and Truthful Documentation

**Files:**
- Create: `scripts/verify-portable-offline.ts`
- Create: `src/__tests__/portable-offline.test.ts`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: built stdio executable, ephemeral local engine fixture, signed test entitlement.
- Produces: `npm run verify:portable-offline` acceptance gate and truthful install/run documentation.

- [ ] **Step 1: Write the failing offline acceptance test**

The harness must start a loopback engine fixture, poison DNS/proxy variables for `co2router.com`, launch the MCP executable over stdio, call `co2router_route`, and assert:

- one private-engine request was received;
- zero hosted requests were attempted;
- the returned MCP content contains the fixture decision and proof;
- the process remains functional after hosted network denial;
- an expired entitlement fails before engine I/O.

- [ ] **Step 2: Run and verify the red state**

Run: `npm run verify:portable-offline`

Expected: FAIL before the harness and executable integration exist.

- [ ] **Step 3: Implement the hermetic harness**

Use only local ephemeral ports and generated Ed25519 test keys. Do not call real grid providers, facilitators, Stripe, `co2router.com`, or a production database. Emit a machine-readable result:

```json
{
  "offlineDecisionPassed": true,
  "engineRequests": 1,
  "hostedRequests": 0,
  "expiredLicenseRejected": true
}
```

- [ ] **Step 4: Rewrite README claims to match evidence**

Document:

- CO2 Router is one portable product;
- exact local stdio installation and configuration;
- local license/trust files;
- private engine requirement;
- cached/bundled/live provenance rules;
- this phase supports read/simulate/decision only;
- x402 is acquisition, not mandatory local per-call payment;
- Authority execution/fencing and signed updates remain outside this phase until their acceptance gates pass.

- [ ] **Step 5: Add CI gate and run the full release matrix**

Run:

```bash
npm ci
npm test
npm run verify:portable-offline
npm run type-check
npm run build
npm run audit:production
```

Expected: every command exits `0`, offline JSON reports `hostedRequests: 0`, and no generated license/private key/build artifact appears in `git status`.

- [ ] **Step 6: Inspect and commit**

```bash
git diff --check
git status --short
git diff --cached --name-only
git add README.md .github/workflows/ci.yml .gitignore package.json scripts/verify-portable-offline.ts src/__tests__/portable-offline.test.ts
git commit -m "test: prove portable CO2 Router operation offline"
```

---

## Deferred Plans Required by the Locked Specification

These are not silently included in the foundation phase:

1. **Signal provenance and policy-specific freshness plan** — align engine signal envelopes and deterministic `ACCEPT/DEGRADE/REJECT` behavior.
2. **Authority execution plan** — signed payload-bound approval grants, durable nonce/replay store, expiry behavior, and engine-side verification.
3. **Target adapters plan** — B1 fencing fixture, B2 idempotency/conditional mutation fixture, and Class C partition denial.
4. **Commerce and release plan** — x402 one-time purchase, entitlement issuance, signed container/npm artifacts, SBOM, update signatures, and Registry metadata.
5. **Local state/evidence plan** — embedded single-node store, enterprise PostgreSQL store, tamper-evident chain, emergency audit journal, and export contract.

Each deferred plan starts only after the foundation acceptance matrix is green and committed.
