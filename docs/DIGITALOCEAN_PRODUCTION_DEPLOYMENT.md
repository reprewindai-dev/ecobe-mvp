# DigitalOcean Production Deployment

`ecobe-mvp` is deployed on DigitalOcean.

## App spec

- App Platform spec: [`.do/app.yaml`](/Users/antho/.windsurf/ecobe-mvp/.do/app.yaml)
- Source: `reprewindai-dev/ecobe-mvp`
- Branch: `main`
- Runtime: Dockerfile-based deployment on App Platform

## Production boundary

- `ecobe-mvp` is the public broker boundary for `CO2 Router` and `HaloGrid`
- `ecobe-engine` remains private behind brokered internal calls only
- no Railway services, private networking, or Railway-specific config belong in this repo

## Runtime requirements

- `DATABASE_URL`
- `ECOBE_ENGINE_URL`
- `ECOBE_ENGINE_INTERNAL_KEY`
- `SEKED_URL`
- `CONVERGEOS_URL`
- `AUDIT_SIGNING_SECRET`
- `ECOBE_ADMIN_TOKEN`
- `STRIPE_WEBHOOK_SECRET` when Stripe webhooks are enabled

## Deployment rule

- keep platform config external to the application source
- keep broker identity and path allowlists enforced in code
- do not reintroduce Railway-specific deployment artifacts
