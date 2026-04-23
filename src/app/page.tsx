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
    { label: 'Runs', value: countLabel(overview.metrics.runs) },
    { label: 'Policies', value: countLabel(overview.metrics.activePolicies) },
    { label: 'Approvals', value: countLabel(overview.metrics.pendingApprovals) },
    { label: 'Revenue', value: currencyLabel(overview.metrics.estimatedRevenue) },
  ]

  const heroStateLabel = overview.status === 'ready' ? 'Connected live' : 'Degraded snapshot'
  const heroStateCopy =
    overview.status === 'ready'
      ? 'Live backend connected. This is the real operating mode.'
      : 'Simulation fallback active. The surface still renders, but live dependencies are missing.'
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
    { label: 'Mode', value: modeLabel },
    { label: 'Live state', value: heroStateLabel },
    { label: 'Proof', value: overview.signals.auditTrailAvailable ? 'available' : 'pending' },
    { label: 'Replay', value: overview.signals.replayAvailable ? 'available' : 'pending' },
  ]

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">CO2 Router</div>
          <div className="brand-subtitle">Decision Infrastructure Interface</div>
        </div>

        <nav className="topnav" aria-label="Primary">
          <a href="#overview">Overview</a>
          <a href="#audit">Audit</a>
          <a href="#actions">Actions</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <section className="hero" id="overview">
        <div className="hero__copy">
          <span className="eyebrow">Live control plane</span>
          <h1>Approve the run. Keep the proof.</h1>
          <p className="hero__lede">
            In three seconds, an operator sees whether the system is live, what is degraded, and which
            decision path is available next. Buyers pay for the part that prevents waste, proves the choice,
            and keeps the engine private while the public surface stays defensible.
          </p>

          <div className="hero__actions">
            <a href="#audit" className="button button--primary">
              Open cockpit
            </a>
            <a href="#actions" className="button button--ghost">
              View proof path
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
            <div className="surface-card__label">Current posture</div>
            <div className="surface-card__value">{heroStateLabel}</div>
            <div className="surface-card__meta">{heroStateCopy}</div>
          </div>

          <div className="surface-feed" aria-label="Control-plane signal lanes">
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
          <span className="eyebrow">Pain point</span>
          <h2 id="wallet-heading">This exists because reporting is not control, and control is what gets bought.</h2>
          <p>
            Teams do not spend on another dashboard. They spend when the system can prevent carbon waste,
            preserve audit evidence, and make the execution choice defensible to finance, ops, and compliance.
          </p>
        </div>

        <div className="pain-grid">
          <article className="pain-card">
            <div className="pain-card__title">Stop the waste</div>
            <p>Without live authority, expensive workloads run in the wrong window and the bill goes up anyway.</p>
          </article>
          <article className="pain-card">
            <div className="pain-card__title">Prove the choice</div>
            <p>Buyers want a replayable record that shows why a run was approved, delayed, rerouted, or denied.</p>
          </article>
          <article className="pain-card">
            <div className="pain-card__title">Keep the engine private</div>
            <p>The control plane can be public. The mechanism stays hidden, so the operator sees the outcome not the recipe.</p>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="proof-heading" id="audit">
        <div className="section__head">
          <span className="eyebrow">Assurance</span>
          <h2 id="proof-heading">Five binding actions. One replayable decision path.</h2>
          <p>
            The product is not a dashboard that watches the system from the outside. It is the authority that
            decides whether a run should proceed, wait, move, slow down, or stop.
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
          <span className="eyebrow">Evidence</span>
          <h2>Every decision carries proof, replay, and a reason a customer can defend.</h2>
          <p>
            The control plane is built to preserve provenance without oversharing internals. That means the
            customer sees the outcome, the operator can inspect the path, and the engine stays private.
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
          <span className="eyebrow">Live metrics</span>
          <h2>Operational posture</h2>
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
          <h2>Built to sell control, proof, and replay at the point of execution.</h2>
          <p>
            The pitch is simple: customers pay for a system that enforces policy, preserves auditability, and
            keeps the private engine boundary invisible to the public surface.
          </p>
        </div>

        <div className="pricing-grid">
          <article className="price-card">
            <div className="price-card__tier">Operator</div>
            <div className="price-card__value">Control</div>
            <p>Best for teams that need a live authority for approval, delay, reroute, throttle, and deny.</p>
            <div className="price-card__actions">
              <a className="button button--primary" href="/pay?plan=tier_1">
                Pay now
              </a>
            </div>
          </article>
          <article className="price-card">
            <div className="price-card__tier">Assurance</div>
            <div className="price-card__value">Proof</div>
            <p>Best for customers that need a replayable decision path and a defensible answer for audit.</p>
            <div className="price-card__actions">
              <a className="button button--primary" href="/pay?plan=tier_2">
                Pay now
              </a>
            </div>
          </article>
          <article className="price-card">
            <div className="price-card__tier">Enterprise</div>
            <div className="price-card__value">Authority</div>
            <p>Best for buyers that want the control plane embedded into their operating model and contracts.</p>
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
          <h2>Operators get the answer, buyers get the proof, and the engine stays private.</h2>
        </div>
        <div className="cta__actions">
          <a href="/api/v1/public/overview" className="button button--primary">
            Live summary JSON
          </a>
          <a href="/api/v1/health" className="button button--ghost">
            System health
          </a>
        </div>
      </section>
    </main>
  )
}
