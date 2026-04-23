# DigitalOcean Production Deployment

`ecobe-mvp` is deployed on DigitalOcean App Platform.

## App spec

- App Platform spec: [`.do/app.yaml`](/Users/antho/OneDrive/Desktop/.windsurf/ecobe-mvp/.do/app.yaml)
- Source: `reprewindai-dev/ecobe-mvp`
- Branch: `main`
- Runtime: `Dockerfile`-based deployment

## Production boundary

- `ecobe-mvp` is the public controller layer for policy storage, decision routing, and proof logging
- `ENGINE_URL` points at the private engine service
- no Railway-specific config belongs in this repo

## Runtime requirements

- `ENGINE_URL`
- `PORT` optional, defaults to `3000`

## Deployment rule

- keep platform config external to the application source
- keep broker/engine separation enforced in code
- do not reintroduce Railway-specific deployment artifacts
