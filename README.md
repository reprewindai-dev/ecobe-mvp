# CO2 Router Authority and MCP Runtime

CO2 Router is one portable product:

- `ecobe-mvp` is the Authority, MCP, entitlement, scope, approval, and audit boundary.
- `ecobe-engineclaude` is the protected deterministic environmental decision engine.
- HallOGrid is an optional read-only human interface.
- `co2router.com` is the product website, commerce, distribution, update, and optional-services surface.

An installed CO2 Router does not call `co2router.com` for an ordinary local routing decision. Purchase grants permission to run product capabilities; it never grants authority over customer infrastructure.

## Current production boundary

This release exposes these non-mutating MCP tools:

| Tool | Class | Required license scope | Private engine operation |
|---|---|---|---|
| `co2router_route` | `SIMULATE` | `route:simulate` | `POST /api/v1/ci/route` |
| `co2router_explain` | `READ` | `proof:read` | decision trace |
| `co2router_proof` | `READ` | `proof:read` | decision replay/proof |
| `co2router_replay` | `READ` | `replay:read` | decision replay |

No tool in this release mutates customer infrastructure. Authority execution, human approval grants, fencing, and target adapters remain disabled until their separate acceptance gates pass.

## Requirements

- Node.js 22+
- a reachable private `ecobe-engineclaude` deployment
- a signed local license file
- a local issuer trust-store file
- an internal engine authentication key

The local MCP decision path requires no paid API, hosted license lookup, Stripe request, x402 facilitator request, or `co2router.com` request.

## Install and build

```bash
npm ci
npm run prisma:generate
npm run build
```

The stdio executable is produced at `dist/co2router-mcp.mjs`. The package exposes it as `co2router-mcp` when installed as an npm package.

For explicit local development only, generate a temporary development entitlement:

```bash
CO2ROUTER_INSTALLATION_ID=local-installation \
  npx tsx scripts/generate-development-license.ts ./.local/co2router
```

The command writes a private development key. Never distribute it or use it as a production issuer.

## Configuration

```dotenv
CO2ROUTER_LICENSE_FILE=./.local/co2router/license.json
CO2ROUTER_TRUST_STORE_FILE=./.local/co2router/trust-store.json
CO2ROUTER_INSTALLATION_ID=local-installation
CO2ROUTER_PRODUCT_MAJOR_VERSION=1
ECOBE_ENGINE_URL=http://127.0.0.1:8080
ECOBE_ENGINE_INTERNAL_KEY=replace-with-private-engine-key
```

The license is verified locally with Ed25519. Modified payloads, unknown keys, wrong audiences, inactive or expired licenses, and incompatible major versions fail closed.

## MCP stdio

Configure an MCP client to launch:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/ecobe-mvp/dist/co2router-mcp.mjs"],
  "env": {
    "CO2ROUTER_LICENSE_FILE": "/absolute/path/license.json",
    "CO2ROUTER_TRUST_STORE_FILE": "/absolute/path/trust-store.json",
    "CO2ROUTER_INSTALLATION_ID": "customer-installation-id",
    "CO2ROUTER_PRODUCT_MAJOR_VERSION": "1",
    "ECOBE_ENGINE_URL": "http://127.0.0.1:8080",
    "ECOBE_ENGINE_INTERNAL_KEY": "private-engine-key"
  }
}
```

The stdio process emits protocol frames only on stdout. Startup failures are written to stderr and exit non-zero.

## MCP Streamable HTTP

`/mcp` uses the same server and executor as stdio. It requires:

```dotenv
CO2ROUTER_MCP_HTTP_TOKEN=replace-with-long-random-token
CO2ROUTER_MCP_ALLOWED_ORIGINS=https://approved-client.example
```

The HTTP route is stateless with a fresh SDK server and transport per request, bearer authenticated, origin checked when an `Origin` header is present, limited to 1 MiB, and marked `no-store`. Put TLS in front of any non-loopback deployment.

## Truthful degradation

- Engine unavailable: the tool returns an explicit error; it never invents a decision.
- License unverifiable or expired: MCP startup/tool access fails before engine I/O.
- Hosted website, commerce, or facilitator unavailable: locally licensed routing continues.
- Cached or bundled environmental signals must remain labeled as cached or bundled by the engine; this runtime does not relabel provenance as live.
- Consequential execution is not present in this release.

## Release gates

```bash
npm test
npm run verify:portable-offline
npm run type-check
npm run build
npm run audit:production
```

The offline acceptance harness uses a generated Ed25519 entitlement, the built stdio executable, and a loopback engine fixture. It verifies one real MCP decision, zero hosted requests, and rejection of an expired license before engine I/O.

x402 remains available for hosted acquisition and paid hosted routes. It is not a per-call dependency of installed local MCP execution.
