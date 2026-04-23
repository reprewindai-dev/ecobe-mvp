import { buildFallbackPublicOverview, buildPublicOverview } from '@/lib/public-overview'
import type { PlanTier } from '@/lib/billing'

import { PayClient } from './pay-client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function parsePlanTier(value: string | string[] | undefined): PlanTier {
  const normalized = Array.isArray(value) ? value[0] : value
  if (normalized === 'tier_1' || normalized === 'tier_2' || normalized === 'tier_3') {
    return normalized
  }

  return 'tier_2'
}

export default async function PayPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const planTier = parsePlanTier(searchParams?.plan)
  const overview = await buildPublicOverview().catch(() => buildFallbackPublicOverview())
  const modeLabel = overview.status === 'ready' ? 'Live mode' : 'Simulation mode'
  const modeCopy =
    overview.status === 'ready'
      ? 'The control plane is connected to the live backend.'
      : 'The control plane is currently showing a simulated fallback.'

  return (
    <main className="page-shell pay-page">
      <header className="topbar">
        <div>
          <div className="brand-mark">CO2 Router</div>
          <div className="brand-subtitle">Payment and plan activation</div>
        </div>
        <a className="button button--ghost pay-page__back" href="/">
          Back home
        </a>
      </header>

      <section className="pay-hero">
        <div className="pay-hero__copy">
          <span className="eyebrow">Checkout</span>
          <h1>Pay now or come back tomorrow. The checkout path is live.</h1>
          <p>
            This page is the actual payment entry point. It is not a mock screen. It opens Stripe checkout
            for the selected plan and keeps the public mode explicit.
          </p>

          <div className="pay-mode-card">
            <div className="pay-mode-card__label">{modeLabel}</div>
            <div className="pay-mode-card__value">{modeCopy}</div>
          </div>
        </div>

        <div className="pay-hero__panel">
          <div className="surface-card surface-card--accent">
            <div className="surface-card__label">Selected plan</div>
            <div className="surface-card__value">
              {planTier === 'tier_1' ? 'Operator' : planTier === 'tier_2' ? 'Assurance' : 'Enterprise'}
            </div>
            <div className="surface-card__meta">Choose your plan and enter the billing email to start checkout.</div>
          </div>

          <PayClient defaultPlanTier={planTier} />
        </div>
      </section>
    </main>
  )
}
