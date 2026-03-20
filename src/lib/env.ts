export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  ECOBE_ENGINE_URL: (process.env.ECOBE_ENGINE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  ECOBE_ENGINE_INTERNAL_KEY: process.env.ECOBE_ENGINE_INTERNAL_KEY ?? '',
  SEKED_URL: (process.env.SEKED_URL ?? '').replace(/\/$/, ''),
  SEKED_INTERNAL_KEY: process.env.SEKED_INTERNAL_KEY ?? '',
  CONVERGEOS_URL: (process.env.CONVERGEOS_URL ?? '').replace(/\/$/, ''),
  CONVERGEOS_INTERNAL_KEY: process.env.CONVERGEOS_INTERNAL_KEY ?? '',
  USE_LOCAL_GOVERNANCE_FALLBACK:
    process.env.USE_LOCAL_GOVERNANCE_FALLBACK !== undefined
      ? process.env.USE_LOCAL_GOVERNANCE_FALLBACK === 'true'
      : (process.env.NODE_ENV ?? 'development') !== 'production',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  AUDIT_SIGNING_SECRET: process.env.AUDIT_SIGNING_SECRET ?? 'development-audit-secret',
  ECOBE_ADMIN_TOKEN: process.env.ECOBE_ADMIN_TOKEN ?? 'ecobe-admin-local',
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? 'ECOBE Control Plane',
}

export function governanceFallbackAllowed() {
  return env.USE_LOCAL_GOVERNANCE_FALLBACK
}
