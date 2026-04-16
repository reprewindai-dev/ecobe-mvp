export type ExposureTier = 'free' | 'pro' | 'elite' | 'internal'

export type ExposureClass = 'public_free' | 'customer_pro' | 'customer_elite' | 'internal_only'

export type ExposureContext = {
  tier: ExposureTier
  isInternalAdmin?: boolean
}
