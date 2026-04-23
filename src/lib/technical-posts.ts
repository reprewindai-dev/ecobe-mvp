import type { BlogPost } from './blog-posts'

export const technicalPosts: BlogPost[] = [
  {
    slug: 'broker-boundary',
    title: 'How the broker boundary stays public and the engine stays private',
    eyebrow: 'Architecture',
    publishedAt: '2026-04-23',
    summary:
      'Public callers only see the broker layer. Engine paths stay behind allowlists, signed headers, and internal auth.',
    body: [
      'The public contract is the control plane, not the engine. That means caller auth is stripped before upstream dispatch and engine-facing requests are signed as broker traffic.',
      'The important part is not just hiding routes. It is making the broker the only valid path for public traffic and keeping the engine unreachable as a public surface.',
      'This is how the system stays explainable to buyers without exposing the implementation that makes the decision.',
    ],
  },
  {
    slug: 'policy-versioning',
    title: 'Policy packs are versioned, active, and reversible',
    eyebrow: 'Policy',
    publishedAt: '2026-04-23',
    summary:
      'Policies are stored as versions, so teams can move forward without losing the record of what was active.',
    body: [
      'A policy is not a static blob. It is a versioned record with an active state, which makes the latest rule set easy to find and easy to audit later.',
      'That structure gives teams a clean upgrade path. They can change the rules, keep the old versions, and always know what governed a given run.',
      'For technical users, this is the difference between a config dump and a real control system.',
    ],
  },
  {
    slug: 'ledger-and-approval',
    title: 'Every decision goes into the ledger, and risky actions need two people',
    eyebrow: 'Governance',
    publishedAt: '2026-04-23',
    summary:
      'The system records the decision path, and sensitive overrides require explicit approval instead of one-click power.',
    body: [
      'The audit trail is not a side effect. It is the product boundary that keeps the system defensible years later.',
      'For high-risk actions, the design should make one person insufficient. The ledger should capture the requester, the approver, the reason, and the result.',
      'That gives customers accountability without turning the system into a black box or a liability trap.',
    ],
  },
]
