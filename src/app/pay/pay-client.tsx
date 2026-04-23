'use client'

import { type FormEvent, useMemo, useState } from 'react'

import type { PlanTier } from '@/lib/billing'

const planOptions: Array<{ value: PlanTier; label: string; description: string }> = [
  { value: 'tier_1', label: 'Operator', description: 'Best for teams starting with live control.' },
  { value: 'tier_2', label: 'Assurance', description: 'Best for teams that need proof and billing.' },
  { value: 'tier_3', label: 'Enterprise', description: 'Best for teams that need full authority.' },
]

function isPlanTier(value: string | null): value is PlanTier {
  return value === 'tier_1' || value === 'tier_2' || value === 'tier_3'
}

export function PayClient({ defaultPlanTier }: { defaultPlanTier: PlanTier }) {
  const [email, setEmail] = useState('')
  const [planTier, setPlanTier] = useState<PlanTier>(defaultPlanTier)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPlan = useMemo(
    () => planOptions.find((option) => option.value === planTier) ?? planOptions[0],
    [planTier],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/v1/billing/public-checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email,
          planTier,
        }),
      })

      const data = (await response.json()) as { url?: string; error?: string }

      if (!response.ok || !data.url) {
        throw new Error(data.error ?? 'Unable to start checkout')
      }

      window.location.assign(data.url)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to start checkout')
      setLoading(false)
    }
  }

  return (
    <form className="pay-form" onSubmit={handleSubmit}>
      <label className="pay-form__field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="billing@company.com"
          autoComplete="email"
          required
        />
      </label>

      <label className="pay-form__field">
        <span>Plan</span>
        <select
          value={planTier}
          onChange={(event) => {
            const nextPlan = event.target.value
            if (isPlanTier(nextPlan)) {
              setPlanTier(nextPlan)
            }
          }}
        >
          {planOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="pay-form__summary">
        <strong>{selectedPlan.label}</strong>
        <span>{selectedPlan.description}</span>
      </div>

      {error ? <div className="pay-form__error">{error}</div> : null}

      <button className="button button--primary pay-form__submit" type="submit" disabled={loading}>
        {loading ? 'Starting checkout…' : 'Pay now'}
      </button>
    </form>
  )
}
