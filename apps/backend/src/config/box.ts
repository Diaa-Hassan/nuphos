import { optional } from './env'

/**
 * Boxes: cloud machines Nuphos creates on instabox for a user, registered as that
 * user's devices through a one-time join token. One partner key for the whole
 * deployment; the feature is off when it is unset.
 */
export type BoxConfig = {
  instabox: { apiKey: string; apiUrl?: string } | null
  /** Where a Box downloads the CLI and its runtime bundle; unset means the GitHub release. */
  downloadUrl?: string
  /** Paid Box plans. Unset means no plans: Boxes are not capped (development, self-hosting). */
  stripe: { secretKey: string; webhookSecret?: string } | null
}

export function boxConfig(): BoxConfig {
  const apiKey = optional('INSTABOX_API_KEY')
  const stripeKey = optional('STRIPE_SECRET_KEY')?.trim()

  return {
    ...(optional('NUPHOS_BOX_DOWNLOAD_URL')
      ? { downloadUrl: optional('NUPHOS_BOX_DOWNLOAD_URL') }
      : {}),
    instabox: apiKey
      ? {
          apiKey,
          ...(optional('INSTABOX_API_URL') ? { apiUrl: optional('INSTABOX_API_URL') } : {}),
        }
      : null,
    stripe: stripeKey
      ? { secretKey: stripeKey, webhookSecret: optional('STRIPE_WEBHOOK_SECRET')?.trim() }
      : null,
  }
}
