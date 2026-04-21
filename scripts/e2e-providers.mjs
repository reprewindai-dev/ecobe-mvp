import { once } from 'events'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import fs from 'fs'

import EmbeddedPostgres from 'embedded-postgres'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const mvpRoot = path.resolve(__dirname, '..')
const windsurfRoot = path.resolve(mvpRoot, '..')
const engineRoot = path.resolve(windsurfRoot, 'ecobe-engineclaude')
const sekedRoot = path.resolve(windsurfRoot, 'seked-service')
const convergeosRoot = path.resolve(windsurfRoot, 'convergeos-service')

const postgresPort = 35435
const mvpPort = 3305
const enginePort = 38085
const sekedPort = 39090
const convergeosPort = 39091
const databaseName = 'ecobe_platform'

const dbBaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/${databaseName}`
const mvpDbUrl = `${dbBaseUrl}?schema=mvp`
const engineDbUrl = dbBaseUrl

const logDir = path.join(mvpRoot, '.local', 'logs')
const postgresDir = path.join(mvpRoot, '.local', 'postgres', `providers-${Date.now()}`)
const mvpEnvFile = path.join(mvpRoot, '.env.production.local')
const forbiddenFields = [
  'traceHash',
  'proofHash',
  'previousTraceHash',
  'inputSignalHash',
  'governanceSource',
  'reasonCode',
  'operatingMode',
  'computeMs',
  'cacheHit',
]

async function main() {
  logStep('Preparing directories and environment.')
  fs.mkdirSync(logDir, { recursive: true })
  fs.mkdirSync(path.dirname(postgresDir), { recursive: true })

  const persistedEnv = parseEnvFile(mvpEnvFile)
  const engineInternalKey = ensureString(
    persistedEnv.ECOBE_ENGINE_INTERNAL_KEY ?? 'replace-with-shared-internal-key',
    'ECOBE_ENGINE_INTERNAL_KEY',
  )
  const sekedInternalKey = ensureString(
    persistedEnv.SEKED_INTERNAL_KEY ?? engineInternalKey,
    'SEKED_INTERNAL_KEY',
  )
  const convergeosInternalKey = ensureString(
    persistedEnv.CONVERGEOS_INTERNAL_KEY ?? engineInternalKey,
    'CONVERGEOS_INTERNAL_KEY',
  )
  const adminToken = ensureString(
    persistedEnv.ECOBE_ADMIN_TOKEN ?? 'ecobe-admin-local',
    'ECOBE_ADMIN_TOKEN',
  )

  const pg = new EmbeddedPostgres({
    databaseDir: postgresDir,
    port: postgresPort,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    onLog: () => undefined,
    onError: (error) => {
      console.error(error)
    },
  })

  const processes = []

  try {
    logStep('Booting embedded Postgres.')
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(databaseName).catch(() => undefined)

    logStep('Applying MVP schema.')
    await runCommand('npm', ['run', 'prisma:push'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        DATABASE_URL: mvpDbUrl,
      },
    })

    logStep('Applying engine schema and migrations.')
    await runCommand('npm', ['run', 'prisma:migrate:deploy'], {
      cwd: engineRoot,
      env: {
        ...process.env,
        DATABASE_URL: engineDbUrl,
        DIRECT_DATABASE_URL: engineDbUrl,
      },
    })
    logStep('Building Seked, ConvergeOS, and MVP.')
    await runCommand('npm', ['run', 'build'], { cwd: sekedRoot, env: process.env })
    await runCommand('npm', ['run', 'build'], { cwd: convergeosRoot, env: process.env })
    await runCommand('npm', ['run', 'build'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        DATABASE_URL: mvpDbUrl,
      },
    })

    logStep('Starting Seked service.')
    const sekedProcess = spawnProcess('node', ['dist/server.js'], {
      cwd: sekedRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(sekedPort),
        HOST: '127.0.0.1',
        SEKED_INTERNAL_KEY: sekedInternalKey,
      },
      label: 'seked',
      logFile: path.join(logDir, 'seked.log'),
    })
    processes.push(sekedProcess)

    logStep('Starting ConvergeOS service.')
    const convergeosProcess = spawnProcess('node', ['dist/server.js'], {
      cwd: convergeosRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(convergeosPort),
        HOST: '127.0.0.1',
        CONVERGEOS_INTERNAL_KEY: convergeosInternalKey,
      },
      label: 'convergeos',
      logFile: path.join(logDir, 'convergeos.log'),
    })
    processes.push(convergeosProcess)

    logStep('Starting engine in internal-only mode.')
    const engineProcess = spawnProcess('npm', ['run', 'dev'], {
      cwd: engineRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(enginePort),
        DATABASE_URL: engineDbUrl,
        DIRECT_DATABASE_URL: engineDbUrl,
        REDIS_URL: 'disabled',
        ECOBE_INTERNAL_API_KEY: engineInternalKey,
        ENGINE_BACKGROUND_WORKERS_ENABLED: 'false',
        ENGINE_OPTIONAL_WORKERS_ENABLED: 'false',
        LEGACY_PUBLIC_API_ENABLED: 'false',
      },
      label: 'engine',
      logFile: path.join(logDir, 'engine-providers.log'),
    })
    processes.push(engineProcess)

    logStep('Waiting for Seked, ConvergeOS, and engine health checks.')
    await waitForHttp(`http://127.0.0.1:${sekedPort}/health`, 60000)
    await waitForHttp(`http://127.0.0.1:${convergeosPort}/health`, 60000)
    await waitForHttp(`http://127.0.0.1:${enginePort}/internal/v1/health`, 90000, {
      authorization: `Bearer ${engineInternalKey}`,
    })

    logStep('Verifying Seked and ConvergeOS auth-protected endpoints.')
    await assertGovernanceProviderAuth({
      sekedUrl: `http://127.0.0.1:${sekedPort}`,
      sekedInternalKey,
      convergeosUrl: `http://127.0.0.1:${convergeosPort}`,
      convergeosInternalKey,
    })

    logStep('Starting MVP with strict external governance (fallback off).')
    const mvpProcess = spawnProcess('npm', ['run', 'start', '--', '-p', String(mvpPort), '-H', '0.0.0.0'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(mvpPort),
        DATABASE_URL: mvpDbUrl,
        NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${mvpPort}`,
        ECOBE_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
        ECOBE_ENGINE_INTERNAL_KEY: engineInternalKey,
        SEKED_URL: `http://127.0.0.1:${sekedPort}`,
        SEKED_INTERNAL_KEY: sekedInternalKey,
        CONVERGEOS_URL: `http://127.0.0.1:${convergeosPort}`,
        CONVERGEOS_INTERNAL_KEY: convergeosInternalKey,
        USE_LOCAL_GOVERNANCE_FALLBACK: 'false',
        ECOBE_ADMIN_TOKEN: adminToken,
        AUDIT_SIGNING_SECRET: persistedEnv.AUDIT_SIGNING_SECRET || 'local-audit-secret',
        WEBHOOK_SECRET_ENCRYPTION_KEY:
          persistedEnv.WEBHOOK_SECRET_ENCRYPTION_KEY || 'replace-with-a-32-byte-random-secret',
      },
      label: 'mvp',
      logFile: path.join(logDir, 'mvp-providers.log'),
    })
    processes.push(mvpProcess)

    logStep('Waiting for MVP readiness.')
    await waitForHttp(`http://127.0.0.1:${mvpPort}/api/v1/ready`, 90000)

    logStep('Validating MVP dependency status payload.')
    const readyPayload = await fetchJson(`http://127.0.0.1:${mvpPort}/api/v1/ready`)
    assert(readyPayload.status === 'ready', `MVP ready endpoint returned ${readyPayload.status}`)
    assert(
      readyPayload.checks?.engine?.status === 'healthy',
      `Engine dependency is ${readyPayload.checks?.engine?.status}`,
    )
    assert(
      readyPayload.checks?.seked?.status === 'healthy',
      `Seked dependency is ${readyPayload.checks?.seked?.status}`,
    )
    assert(
      readyPayload.checks?.convergeos?.status === 'healthy',
      `ConvergeOS dependency is ${readyPayload.checks?.convergeos?.status}`,
    )

    logStep('Verifying engine public routes are not exposed.')
    const legacyResponse = await fetch(`http://127.0.0.1:${enginePort}/api/v1/route/green`, {
      cache: 'no-store',
    })
    assert(legacyResponse.status === 404, `Engine public route returned ${legacyResponse.status}, expected 404`)

    logStep('Running strict governed run verification through MVP.')
    const baseUrl = `http://127.0.0.1:${mvpPort}`
    const bootstrap = await bootstrapTenant(baseUrl, adminToken)
    const runEnvelope = await executeVerificationRun(baseUrl, bootstrap.apiKey)
    assert(runEnvelope.status === 'completed', `Run status was ${runEnvelope.status}`)
    assert(runEnvelope.runId, 'Run envelope is missing runId')
    assert(runEnvelope.routing?.estimatedLatencyMs !== undefined, 'Run envelope is missing routing latency summary')
    assert(runEnvelope.routing?.estimatedCostUsd !== undefined, 'Run envelope is missing routing cost summary')
    assertNoForbiddenFields(runEnvelope, forbiddenFields)
    assertProofContract(runEnvelope, 'pro')

    const runDetail = await fetchJsonWithStatus(`${baseUrl}/api/v1/runs/${runEnvelope.runId}`, {
      headers: {
        'x-api-key': bootstrap.apiKey,
      },
    })
    assert(runDetail.status === 200, `Run detail endpoint returned ${runDetail.status}`)
    assertNoForbiddenFields(runDetail.data, forbiddenFields)
    assertProofContract(runDetail.data, 'pro')

    const runEvents = await fetchJsonWithStatus(`${baseUrl}/api/v1/runs/${runEnvelope.runId}/events`, {
      headers: {
        'x-api-key': bootstrap.apiKey,
      },
    })
    assert(runEvents.status === 200, `Run events endpoint returned ${runEvents.status}`)
    assertNoForbiddenFields(runEvents.data, forbiddenFields)

    const usageResponse = await fetchJsonWithStatus(`${baseUrl}/api/v1/usage`, {
      headers: {
        'x-api-key': bootstrap.apiKey,
      },
    })
    assert(usageResponse.status === 200, `Usage endpoint returned ${usageResponse.status}`)

    const dashboardResponse = await fetchJsonWithStatus(`${baseUrl}/api/v1/dashboard/overview`, {
      headers: {
        authorization: `Bearer ${bootstrap.serviceAccountKey}`,
      },
    })
    assert(dashboardResponse.status === 200, `Dashboard endpoint returned ${dashboardResponse.status}`)

    console.log('Provider wiring verification passed.')
  } finally {
    for (const child of processes.reverse()) {
      await terminateProcess(child)
    }

    await pg.stop().catch(() => undefined)
  }
}

function logStep(message) {
  console.log(`\n[e2e:providers] ${message}`)
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const env = {}
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator < 0) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }

  return env
}

function ensureString(value, key) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required for provider verification`)
  }
  return value.trim()
}

function spawnProcess(command, args, options) {
  const logStream = fs.createWriteStream(options.logFile, { flags: 'a' })
  const { label, logFile, ...spawnOptions } = options
  const invocation = resolveInvocation(command, args)
  const child = spawn(invocation.command, invocation.args, {
    ...spawnOptions,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`)
    logStream.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`)
    logStream.write(chunk)
  })

  child.on('exit', (code, signal) => {
    logStream.write(`\n[process-exit] code=${code} signal=${signal}\n`)
    logStream.end()
  })

  return child
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(command, args)
    const child = spawn(invocation.command, invocation.args, {
      ...options,
      shell: false,
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`))
    })
  })
}

function resolveInvocation(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    }
  }

  return { command, args }
}

async function waitForHttp(url, timeoutMs, headers = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers,
      })
      if (response.ok) {
        return
      }
    } catch {
      // Keep waiting until timeout.
    }

    await sleep(1000)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
  })

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

async function fetchJsonWithStatus(url, init) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return {
    status: response.status,
    data,
  }
}

async function bootstrapTenant(baseUrl, adminToken) {
  const response = await fetchJsonWithStatus(`${baseUrl}/api/v1/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ecobe-admin-token': adminToken,
    },
    body: JSON.stringify({
      organizationName: 'Acme Governance',
      organizationSlug: 'acme-governance',
      projectName: 'Support Copilot',
      projectSlug: 'support-copilot',
      environmentSlug: 'production',
    }),
  })

  assert(response.status === 201, `Bootstrap endpoint returned ${response.status}`)
  assert(typeof response.data?.apiKey === 'string', 'Bootstrap did not return apiKey')
  assert(typeof response.data?.serviceAccountKey === 'string', 'Bootstrap did not return serviceAccountKey')

  return {
    apiKey: response.data.apiKey,
    serviceAccountKey: response.data.serviceAccountKey,
  }
}

async function executeVerificationRun(baseUrl, apiKey) {
  const response = await fetchJsonWithStatus(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      environmentSlug: 'production',
      input: {
        output: {
          message: 'Provider wiring verification completed.',
        },
      },
      providerConstraints: {
        preferredRegions: ['FR', 'US-EAST-1'],
        providers: ['openai'],
      },
      latencyCeiling: 250,
      costCeiling: 0.08,
      model: 'gpt-4.1',
      tokenCount: 12000,
      output: {
        message: 'Provider wiring verification completed.',
      },
    }),
  })

  assert(response.status === 201, `Run endpoint returned ${response.status}`)
  return response.data
}

async function assertGovernanceProviderAuth(input) {
  const sekedResponse = await fetch(`${input.sekedUrl}/v1/governance/evaluate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.sekedInternalKey}`,
    },
    body: JSON.stringify({
      input: {
        prompt: 'Provider auth verification request.',
      },
      rules: {
        strictMode: false,
      },
    }),
    cache: 'no-store',
  })
  assert(sekedResponse.ok, `Seked evaluate returned ${sekedResponse.status}`)

  const convergeosResponse = await fetch(`${input.convergeosUrl}/v1/converge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.convergeosInternalKey}`,
    },
    body: JSON.stringify({
      payload: {
        test: true,
      },
    }),
    cache: 'no-store',
  })
  assert(convergeosResponse.ok, `ConvergeOS converge returned ${convergeosResponse.status}`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertNoForbiddenFields(value, blocked) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoForbiddenFields(entry, blocked))
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    if (blocked.includes(key)) {
      throw new Error(`Forbidden field found in payload: ${key}`)
    }
    assertNoForbiddenFields(entry, blocked)
  }
}

function assertProofContract(value, tier) {
  if (!value?.proof) {
    return
  }

  assert(typeof value.proof.proofRef === 'string' && value.proof.proofRef.length > 0, 'Proof envelope is missing proofRef')

  if (tier === 'pro') {
    assert(!('decisionRef' in value.proof), 'Pro proof envelope should not expose decisionRef')
  }
}

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

async function terminateProcess(child) {
  if (!child?.pid) {
    return
  }

  if (child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]).catch(() => undefined)
    return
  }

  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).catch(() => undefined)
}

await main()
