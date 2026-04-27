function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function cleanEnvValue(value: string | undefined) {
  return stripWrappingQuotes(
    (value ?? '')
      .replace(/\\r\\n|\\n|\\r/g, '')
      .replace(/[\r\n]+/g, '')
      .trim(),
  )
}

function cleanUrlEnvValue(value: string | undefined) {
  return cleanEnvValue(value).replace(/\/$/, '')
}

export const env = {
  NODE_ENV: cleanEnvValue(process.env.NODE_ENV) || 'development',
  DATABASE_URL: cleanEnvValue(process.env.DATABASE_URL),
  NEXT_PUBLIC_APP_URL: cleanUrlEnvValue(process.env.NEXT_PUBLIC_APP_URL),
  ECOBE_API_URL: cleanUrlEnvValue(process.env.ECOBE_API_URL),
  ECOBE_ENGINE_URL: cleanUrlEnvValue(process.env.ECOBE_ENGINE_URL),
  ECOBE_ENGINE_INTERNAL_KEY: cleanEnvValue(process.env.ECOBE_ENGINE_INTERNAL_KEY),
  ECOBE_BROKER_ID: cleanEnvValue(process.env.ECOBE_BROKER_ID) || 'ecobe-mvp',
  CRON_SECRET: cleanEnvValue(process.env.CRON_SECRET),
  SANDBOX_WARM_TOKEN: cleanEnvValue(process.env.SANDBOX_WARM_TOKEN),
  SEKED_URL: cleanUrlEnvValue(process.env.SEKED_URL),
  SEKED_INTERNAL_KEY: cleanEnvValue(process.env.SEKED_INTERNAL_KEY),
  CONVERGEOS_URL: cleanUrlEnvValue(process.env.CONVERGEOS_URL),
  CONVERGEOS_INTERNAL_KEY: cleanEnvValue(process.env.CONVERGEOS_INTERNAL_KEY),
  USE_LOCAL_GOVERNANCE_FALLBACK:
    process.env.USE_LOCAL_GOVERNANCE_FALLBACK !== undefined
      ? process.env.USE_LOCAL_GOVERNANCE_FALLBACK === 'true'
      : cleanEnvValue(process.env.NODE_ENV) !== 'production',
  STRIPE_SECRET_KEY: cleanEnvValue(process.env.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: cleanEnvValue(process.env.STRIPE_WEBHOOK_SECRET),
  STRIPE_TIER_1_PRICE_ID: cleanEnvValue(process.env.STRIPE_TIER_1_PRICE_ID),
  STRIPE_TIER_2_PRICE_ID: cleanEnvValue(process.env.STRIPE_TIER_2_PRICE_ID),
  STRIPE_TIER_3_PRICE_ID: cleanEnvValue(process.env.STRIPE_TIER_3_PRICE_ID),
  STRIPE_CHECKOUT_SUCCESS_URL: cleanUrlEnvValue(process.env.STRIPE_CHECKOUT_SUCCESS_URL),
  STRIPE_CHECKOUT_CANCEL_URL: cleanUrlEnvValue(process.env.STRIPE_CHECKOUT_CANCEL_URL),
  STRIPE_PORTAL_RETURN_URL: cleanUrlEnvValue(process.env.STRIPE_PORTAL_RETURN_URL),
  AUDIT_SIGNING_SECRET: cleanEnvValue(process.env.AUDIT_SIGNING_SECRET) || 'development-audit-secret',
  WEBHOOK_SECRET_ENCRYPTION_KEY: cleanEnvValue(process.env.WEBHOOK_SECRET_ENCRYPTION_KEY),
  ECOBE_ADMIN_TOKEN: cleanEnvValue(process.env.ECOBE_ADMIN_TOKEN) || 'ecobe-admin-local',
  NEXT_PUBLIC_APP_NAME: cleanEnvValue(process.env.NEXT_PUBLIC_APP_NAME) || 'ECOBE Control Plane',
  OLLAMA_BASE_URL: cleanUrlEnvValue(process.env.OLLAMA_BASE_URL),
  OLLAMA_MODEL: cleanEnvValue(process.env.OLLAMA_MODEL) || 'qwen2.5:1.5b',
  OLLAMA_NUM_PREDICT: Number(cleanEnvValue(process.env.OLLAMA_NUM_PREDICT) || 4096),
  OLLAMA_MAX_ATTEMPTS: Number(cleanEnvValue(process.env.OLLAMA_MAX_ATTEMPTS) || 2),
}

export function getEngineBaseUrl() {
  return env.ECOBE_ENGINE_URL || env.ECOBE_API_URL
}

export function governanceFallbackAllowed() {
  return env.USE_LOCAL_GOVERNANCE_FALLBACK
}

export function engineConfigured() {
  return Boolean(getEngineBaseUrl() && env.ECOBE_ENGINE_INTERNAL_KEY)
}
