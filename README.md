# ecobe-mvp

## Workspace Map

This workspace is split across four production repos:

- `ecobe-engineclaude`: the canonical engine. Owns routing, replay, proof, adapters, and provider intelligence.
- `co2router-site`: the public-facing website. Owns the marketing site and the interactive CI/CD demo.
- `co2router-site` remote tech checkout: the same site repo on a separate branch for the operator and proof surface.
- `ecobe-mvp`: the remote runtime and proxy. Accepts demo traffic and forwards it to the engine over the private boundary.

`ecobe-mvp` is a Node.js Express controller for policy storage, decision routing, and proof logging.

## Runtime

- Node.js 20+
- Express
- In-memory state only

## Environment

- `ENGINE_URL=http://localhost:3001`
- `PORT=3000`

## Endpoints

### `POST /policies`

Stores a policy in memory.

```json
{
  "name": "default",
  "threshold": 250,
  "delay_seconds": 30
}
```

Response:

```json
{
  "status": "saved",
  "policy_id": "uuid"
}
```

### `GET /policies`

Returns all stored policies.

### `POST /decision`

Creates a decision for a job.

```json
{
  "job_id": "job-123",
  "timestamp": "2026-04-23T12:00:00.000Z",
  "workload_type": "batch"
}
```

Behavior:

- uses the latest policy, or a default policy if none exist
- generates a carbon value between 100 and 600
- calls `ENGINE_URL/evaluate`
- fail-opens to `RUN` if the engine fails
- stores a proof in memory

Response:

```json
{
  "action": "RUN",
  "delay_seconds": 0,
  "proof_id": "uuid",
  "carbon_value": 412
}
```

### `GET /proofs`

Returns the in-memory proof log.

### `GET /health`

Returns service health.

## Commands

```bash
npm install
npm run dev
npm run build
npm start
```
