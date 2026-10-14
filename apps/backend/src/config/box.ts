import { optional } from './env'

/**
 * Boxes: cloud machines Nuphos creates on instabox for a user, registered as that
 * user's devices through a one-time join token. One partner key for the whole
 * deployment; the feature is off when it is unset.
 */
export type BoxConfig = {
  instabox: { apiKey: string; apiUrl?: string } | null
}

export function boxConfig(): BoxConfig {
  const apiKey = optional('INSTABOX_API_KEY')

  return {
    instabox: apiKey
      ? {
          apiKey,
          ...(optional('INSTABOX_API_URL') ? { apiUrl: optional('INSTABOX_API_URL') } : {}),
        }
      : null,
  }
}
