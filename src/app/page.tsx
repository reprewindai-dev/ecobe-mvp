import { buildPublicOverview, type PublicOverview } from '@/lib/public-overview'

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
  const overview = await buildPublicOverview()
  const liveStatuses = buildLiveStatuses(overview)

  const metrics = [
    { label: 'Organizations', value: countLabel(overview.metrics.organizations) },
    { label: 'Governed runs', value: countLabel(overview.metrics.runs) },
    { label: 'Active policies', value: countLabel(overview.metrics.activePolicies) },
    { label: 'Pending approvals', value: countLabel(overview.metrics.pendingApprovals) },
    { label: 'Open alerts', value: countLabel(overview.metrics.openAlerts) },
    { label: 'Audit exports', value: countLabel(overview.metrics.auditExports) },
  ]

  const heroStateLabel = overview.status === 'ready' ? 'Connected live' : 'Degraded snapshot'
  const heroStateCopy =
    overview.status === 'ready'
      ? 'Public-safe live read from the control plane'
      : 'Live dependencies are still resolving, but the surface remains readable'
  const cockpitStrip = [
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
            In three seconds, an operator sees what is live, what is degraded, and what the control plane will
            do next. This is the public face of the gate: it turns signals into a binding decision before
            execution and keeps the proof chain intact.
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

          <div className="hero__pain">
            <div className="hero__pain-title">What this replaces</div>
            <ul>
              <li>A status page that only reports after the fact.</li>
              <li>A dashboard that cannot stop or reroute a run.</li>
              <li>A compliance story with no live authority behind it.</li>
            </ul>
          </div>
        </div>

        <div className="hero__surface">
          <div className="surface-card surface-card--accent">
            <div className="surface-card__label">Live status</div>
            <div className="surface-card__value">{heroStateLabel}</div>
            <div className="surface-card__meta">{heroStateCopy}</div>
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
          </article>
          <article className="price-card">
            <div className="price-card__tier">Assurance</div>
            <div className="price-card__value">Proof</div>
            <p>Best for customers that need a replayable decision path and a defensible answer for audit.</p>
          </article>
          <article className="price-card">
            <div className="price-card__tier">Enterprise</div>
            <div className="price-card__value">Authority</div>
            <p>Best for buyers that want the control plane embedded into their operating model and contracts.</p>
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
