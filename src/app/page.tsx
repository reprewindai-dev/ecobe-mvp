import { buildFallbackPublicOverview, buildPublicOverview, type PublicOverview } from '@/lib/public-overview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type LiveStatus = {
  label: string
  value: string
  tone: 'good' | 'warn' | 'neutral'
}

const bindingActions = [
  {
    title: 'Approve',
    description: 'Green-lit workloads proceed when policy, proof, and trust posture are all clear.',
  },
  {
    title: 'Delay',
    description: 'Work can wait for a cleaner window without losing the audit trail.',
  },
  {
    title: 'Reroute',
    description: 'High-carbon or low-confidence paths can move before execution starts.',
  },
  {
    title: 'Throttle',
    description: 'Heavy demand can be slowed when the control plane needs room to breathe.',
  },
  {
    title: 'Deny',
    description: 'Unsafe or non-compliant runs are stopped at the boundary, not after damage.',
  },
]

function toneClass(tone: LiveStatus['tone']) {
  switch (tone) {
    case 'good':
      return 'status-pill status-pill--good'
    case 'warn':
      return 'status-pill status-pill--warn'
    default:
      return 'status-pill status-pill--neutral'
  }
}

function countLabel(value: number | null | undefined) {
  if (value == null || value <= 0) {
    return 'pending'
  }

  return value.toLocaleString()
}

function currencyLabel(value: number | null | undefined) {
  if (value == null || value <= 0) {
    return 'pending'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function statusLabel(value: string | undefined) {
  if (!value) {
    return 'pending'
  }

  if (value === 'healthy' || value === 'ready') {
    return 'live'
  }

  if (value === 'not_configured') {
    return 'not configured'
  }

  return value.replace(/_/g, ' ')
}

function buildLiveStatuses(overview: PublicOverview): LiveStatus[] {
  const database = overview.checks.database
  const engineStatus = overview.checks.engine.status
  const sekedStatus = overview.checks.seked.status
  const convergeosStatus = overview.checks.convergeos.status

  return [
    {
      label: 'System',
      value: overview.status === 'ready' ? 'ready' : 'degraded',
      tone: overview.status === 'ready' ? 'good' : 'warn',
    },
    {
      label: 'Database',
      value: database ? 'live' : 'offline',
      tone: database ? 'good' : 'warn',
    },
    {
      label: 'Engine',
      value: statusLabel(engineStatus),
      tone: engineStatus === 'healthy' ? 'good' : engineStatus ? 'warn' : 'neutral',
    },
    {
      label: 'Seked',
      value: statusLabel(sekedStatus),
      tone: sekedStatus === 'healthy' ? 'good' : sekedStatus ? 'warn' : 'neutral',
    },
    {
      label: 'ConvergeOS',
      value: statusLabel(convergeosStatus),
      tone: convergeosStatus === 'healthy' ? 'good' : convergeosStatus ? 'warn' : 'neutral',
    },
    {
      label: 'Replay',
      value: overview.signals.replayAvailable ? 'available' : 'pending',
      tone: overview.signals.replayAvailable ? 'good' : 'neutral',
    },
  ]
}

export default async function HomePage() {
  const overview = await buildPublicOverview().catch(() => buildFallbackPublicOverview())
  const liveStatuses = buildLiveStatuses(overview)

  const metrics = [
    { label: 'Organizations', value: countLabel(overview.metrics.organizations) },
    { label: 'Governed runs', value: countLabel(overview.metrics.runs) },
    { label: 'Active policies', value: countLabel(overview.metrics.activePolicies) },
    { label: 'Pending approvals', value: countLabel(overview.metrics.pendingApprovals) },
    { label: 'Open alerts', value: countLabel(overview.metrics.openAlerts) },
    { label: 'Audit exports', value: countLabel(overview.metrics.auditExports) },
  ]

  const heroMetrics = [
    { label: 'Customers', value: countLabel(overview.metrics.organizations) },
    { label: 'Runs guided', value: countLabel(overview.metrics.runs) },
    { label: 'Rules live', value: countLabel(overview.metrics.activePolicies) },
    { label: 'Revenue', value: currencyLabel(overview.metrics.estimatedRevenue) },
  ]

  const heroStateLabel = overview.status === 'ready' ? 'Connected live' : 'Degraded snapshot'
  const heroStateCopy =
    overview.status === 'ready'
      ? 'Live platform connected. This is the real thing.'
      : 'Fallback mode is active. The page still works, but live data is missing.'
  const modeLabel = overview.status === 'ready' ? 'Live mode' : 'Simulation mode'
  const heroSignalLines = [
    {
      label: 'Mode',
      value: modeLabel,
      tone: overview.status === 'ready' ? 'good' : 'warn',
    },
    {
      label: 'Database',
      value: overview.checks.database ? 'live' : 'offline',
      tone: overview.checks.database ? 'good' : 'warn',
    },
    {
      label: 'Engine',
      value: statusLabel(overview.checks.engine.status),
      tone: overview.checks.engine.status === 'healthy' ? 'good' : 'warn',
    },
    {
      label: 'Proof',
      value: overview.signals.auditTrailAvailable ? 'available' : 'pending',
      tone: overview.signals.auditTrailAvailable ? 'good' : 'neutral',
    },
    {
      label: 'Replay',
      value: overview.signals.replayAvailable ? 'available' : 'pending',
      tone: overview.signals.replayAvailable ? 'good' : 'neutral',
    },
  ] as const
  const cockpitStrip = [
    { label: 'Status', value: modeLabel },
    { label: 'Live state', value: heroStateLabel },
    { label: 'Proof', value: overview.signals.auditTrailAvailable ? 'available' : 'pending' },
    { label: 'Replay', value: overview.signals.replayAvailable ? 'available' : 'pending' },
  ]

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">CO2 Router</div>
          <div className="brand-subtitle">Simple control for modern teams</div>
        </div>

        <nav className="topnav" aria-label="Primary">
          <a href="#overview">Overview</a>
          <a href="#audit">Demo</a>
          <a href="#actions">Use cases</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <section className="hero" id="overview">
        <div className="hero__copy">
          <span className="eyebrow">Trusted by teams that move fast</span>
          <h1>Control every run. Explain later.</h1>
          <p className="hero__lede">
            Teams get a clear answer fast. You get fewer mistakes and a record you can explain later.
          </p>

          <div className="hero__actions">
            <a href="#audit" className="button button--primary">
              See the demo
            </a>
            <a href="#actions" className="button button--ghost">
              See pricing
            </a>
          </div>

          <div className="cockpit-strip" aria-label="Live cockpit summary">
            {cockpitStrip.map((item) => (
              <div className="cockpit-strip__item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="hero__metrics" aria-label="Live operating metrics">
            {heroMetrics.map((metric) => (
              <div className="hero__metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

        </div>

        <div className="hero__surface">
          <div className="surface-card surface-card--accent">
            <div className="surface-card__label">What they see</div>
            <div className="surface-card__value">{heroStateLabel}</div>
            <div className="surface-card__meta">{heroStateCopy}</div>
          </div>

          <div className="surface-feed" aria-label="Control signal lanes">
            {heroSignalLines.map((item) => (
              <div className="surface-feed__row" key={item.label}>
                <div>
                  <div className="surface-card__label">{item.label}</div>
                  <div className="surface-feed__value">{item.value}</div>
                </div>
                <div className={toneClass(item.tone)}>{item.value}</div>
              </div>
            ))}
          </div>

          <div className="surface-grid">
            {liveStatuses.map((item) => (
              <div className="surface-card" key={item.label}>
                <div className="surface-card__label">{item.label}</div>
                <div className="surface-card__value">{item.value}</div>
                <div className={`surface-card__meta ${toneClass(item.tone)}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="wallet-heading">
        <div className="section__head">
          <span className="eyebrow">Why teams choose it</span>
          <h2 id="wallet-heading">They buy fewer mistakes, cleaner approvals, and a record they can explain later.</h2>
          <p>
            This product helps teams say yes, no, or wait, then shows exactly why the answer was made.
          </p>
        </div>

        <div className="pain-grid">
          <article className="pain-card">
            <div className="pain-card__title">Stop the waste</div>
            <p>The wrong run costs money. This stops it early.</p>
          </article>
          <article className="pain-card">
            <div className="pain-card__title">Prove the choice</div>
            <p>Every decision is tracked and easy to explain later.</p>
          </article>
          <article className="pain-card">
            <div className="pain-card__title">Keep the engine private</div>
            <p>Buyers see the result, not the machinery.</p>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="proof-heading" id="audit">
        <div className="section__head">
          <span className="eyebrow">How it works</span>
          <h2 id="proof-heading">Five ways to guide a run. One clear path.</h2>
          <p>
            Teams can approve, delay, reroute, slow down, or stop a run before it causes damage.
          </p>
        </div>

        <div className="action-grid" id="actions">
          {bindingActions.map((action) => (
            <article className="action-card" key={action.title}>
              <div className="action-card__title">{action.title}</div>
              <p>{action.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--split">
        <article className="panel panel--wide">
          <span className="eyebrow">Record</span>
          <h2>Every decision stays on the record.</h2>
          <p>
            The customer sees the outcome, the operator can inspect the path, and the internal mechanism stays
            private.
          </p>

          <div className="proof-grid">
            <div className="proof-card">
              <span>Proof</span>
              <strong>{overview.signals.auditTrailAvailable ? 'Available' : 'Pending'}</strong>
            </div>
            <div className="proof-card">
              <span>Replay</span>
              <strong>{overview.signals.replayAvailable ? 'Available' : 'Pending'}</strong>
            </div>
            <div className="proof-card">
              <span>Billing</span>
              <strong>{overview.signals.billingLive ? 'Active' : 'Pending'}</strong>
            </div>
            <div className="proof-card">
              <span>Engine</span>
              <strong>{statusLabel(overview.checks.engine.status)}</strong>
            </div>
          </div>
        </article>

        <aside className="panel">
          <span className="eyebrow">Live status</span>
          <h2>What is working now</h2>
          <div className="metric-list">
            {metrics.map((metric) => (
              <div className="metric-row" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="section" id="pricing">
        <div className="section__head">
          <span className="eyebrow">Pricing</span>
          <h2>Pick the level of control your team needs.</h2>
          <p>
            Start with guardrails, expand control when needed, and move to full authority when the team is ready.
          </p>
        </div>

        <div className="pricing-grid">
          <article className="price-card">
            <div className="price-card__tier">Launch</div>
            <div className="price-card__value">Guardrails</div>
            <p>Best for teams that want simple guardrails and immediate clarity.</p>
            <div className="price-card__actions">
              <a className="button button--primary" href="/pay?plan=tier_1">
                Pay now
              </a>
            </div>
          </article>
          <article className="price-card">
            <div className="price-card__tier">Growth</div>
            <div className="price-card__value">Proof</div>
            <p>Best for teams that want more control and a cleaner paper trail.</p>
            <div className="price-card__actions">
              <a className="button button--primary" href="/pay?plan=tier_2">
                Pay now
              </a>
            </div>
          </article>
          <article className="price-card">
            <div className="price-card__tier">Enterprise</div>
            <div className="price-card__value">Authority</div>
            <p>Best for buyers that need more freedom and two-person approval.</p>
            <div className="price-card__actions">
              <a className="button button--primary" href="/pay?plan=tier_3">
                Pay now
              </a>
            </div>
          </article>
        </div>
      </section>

      <section className="cta" id="contact">
        <div>
          <span className="eyebrow">Ready</span>
          <h2>They get the result. You keep the proof.</h2>
        </div>
        <div className="cta__actions">
          <a href="/api/v1/public/overview" className="button button--primary">
            Live summary
          </a>
          <a href="/api/v1/health" className="button button--ghost">
            Status
          </a>
        </div>
      </section>
    </main>
  )
}


