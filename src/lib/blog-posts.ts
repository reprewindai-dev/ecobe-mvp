export type BlogPost = {
  slug: string
  title: string
  summary: string
  eyebrow: string
  publishedAt: string
  body: string[]
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'stop-the-waste',
    title: 'Stop the waste before the bill closes',
    eyebrow: 'Control',
    publishedAt: '2026-04-23',
    summary:
      'A control plane is only valuable when it can block the wrong run early enough to matter financially.',
    body: [
      'The operator does not need another dashboard. They need authority at the point where the workload still can be redirected, delayed, or denied.',
      'That is the difference between reporting and control. Reporting tells you what happened; control changes what happens next.',
      'The buyer pays when the system prevents wasted execution before the invoice is already irreversible.',
    ],
  },
  {
    slug: 'prove-the-choice',
    title: 'Prove the choice with replayable evidence',
    eyebrow: 'Assurance',
    publishedAt: '2026-04-23',
    summary:
      'A defensible execution decision needs a proof chain, not a hand-wave and a screenshot.',
    body: [
      'Every approval, delay, reroute, throttle, or deny should leave behind a record that can be replayed later.',
      'The evidence must show the policy used, the signal that triggered the decision, and the action that was taken.',
      'That is how finance, compliance, and operations all end up looking at the same source of truth.',
    ],
  },
  {
    slug: 'keep-the-engine-private',
    title: 'Keep the engine private and the broker public',
    eyebrow: 'Boundary',
    publishedAt: '2026-04-23',
    summary:
      'The public surface should expose outcomes, not the private mechanism that produced them.',
    body: [
      'The engine stays behind the broker boundary. Public callers should never be able to treat the engine as the API surface.',
      'That separation protects the system from accidental coupling and keeps internal routes out of the public contract.',
      'The user sees the result, the broker keeps the proof, and the engine stays hidden.',
    ],
  },
]
