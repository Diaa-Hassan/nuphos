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
  /** What a Box is made from: an instabox template name or a snapshot id; unset means the default template. */
  template?: string
}

export function boxConfig(): BoxConfig {
  const apiKey = optional('INSTABOX_API_KEY')

  return {
    ...(optional('NUPHOS_BOX_DOWNLOAD_URL')
      ? { downloadUrl: optional('NUPHOS_BOX_DOWNLOAD_URL') }
      : {}),
    ...(optional('NUPHOS_BOX_TEMPLATE') ? { template: optional('NUPHOS_BOX_TEMPLATE') } : {}),
    instabox: apiKey
      ? {
          apiKey,
          ...(optional('INSTABOX_API_URL') ? { apiUrl: optional('INSTABOX_API_URL') } : {}),
        }
      : null,
  }
}
