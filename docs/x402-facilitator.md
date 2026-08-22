# X402 Facilitator

The facilitator verifies and settles x402 payments on-chain. Which one is used
is decided in `src/lib/x402/server.ts` at server construction.

| Condition | Facilitator |
| --- | --- |
| `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are set | CDP hosted facilitator, `https://api.cdp.coinbase.com/platform/v2/x402` |
| otherwise | `CO2ROUTER_X402_FACILITATOR_URL`, default `https://x402.org/facilitator` |

## Base mainnet requires CDP

The default `https://x402.org/facilitator` settles Base Sepolia only. With
`CO2ROUTER_X402_NETWORK=eip155:8453` (the default) and no CDP credentials, the
resource server cannot register the network and every `/x402/v1/*` route fails.
`handleX402Request` detects that combination up front and returns HTTP 503 with
the required configuration, instead of an opaque failure at payment time.

Setting `CO2ROUTER_X402_FACILITATOR_URL` to a non-default value disables the
check: a self-hosted facilitator is assumed to support the configured network.

## CDP authentication

The CDP facilitator does not accept a static bearer token. Each request carries
a short-lived JWT signed with the CDP API key, generated per endpoint
(`/verify`, `/settle`, `/supported`) by `generateJwt` from
`@coinbase/cdp-sdk/auth` and supplied through the `createAuthHeaders` hook of
`HTTPFacilitatorClient`.

Only the auth module of the CDP SDK is used. `@coinbase/cdp-sdk/x402`, which
exposes `createCdpFacilitatorClient`, transitively requires the Solana packages
`@x402/svm/*` that this project does not install.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CDP_API_KEY_ID` | CDP API key id; enables the CDP facilitator |
| `CDP_API_KEY_SECRET` | CDP API key secret (Ed25519 or EC) |
| `CO2ROUTER_X402_NETWORK` | CAIP-2 network, e.g. `eip155:8453` (Base) or `eip155:84532` (Base Sepolia) |
| `CO2ROUTER_X402_FACILITATOR_URL` | Overrides the non-CDP facilitator |
| `CO2ROUTER_X402_FACILITATOR_BEARER_TOKEN` | Static bearer for a self-hosted facilitator |
| `CO2ROUTER_PAY_TO` | Address that receives payment |

## Rollback

Unsetting `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` restores the previous HTTP
facilitator behaviour with no code change; pair it with a testnet
`CO2ROUTER_X402_NETWORK` so the misconfiguration check stays satisfied.
