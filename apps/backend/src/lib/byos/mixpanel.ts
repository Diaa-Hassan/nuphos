import { decryptMixpanelSecret } from '@/lib/byos/secrets'

import type { MixpanelAccountBinding } from '@/models'

// Mixpanel service accounts (docs.mixpanel.com/reference/service-accounts).
// Auth is HTTP Basic with the service account username and its secret — no
// OAuth, no token exchange:
//   curl https://mixpanel.com/api/app/me -u USERNAME:SECRET
// A project lives in exactly one data residency, and each has its own hosts.
export const MIXPANEL_REGIONS = ['us', 'eu', 'in'] as const

export type MixpanelRegion = (typeof MIXPANEL_REGIONS)[number]

const HOSTS: Record<MixpanelRegion, { apiHost: string; dataHost: string }> = {
  us: { apiHost: 'https://mixpanel.com', dataHost: 'https://data.mixpanel.com' },
  eu: { apiHost: 'https://eu.mixpanel.com', dataHost: 'https://data-eu.mixpanel.com' },
  in: { apiHost: 'https://in.mixpanel.com', dataHost: 'https://data-in.mixpanel.com' },
}
const FETCH_TIMEOUT_MS = 30_000

export class MixpanelApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'MixpanelApiError'
  }
}

export type MixpanelCredentials = {
  username: string
  secret: string
  region: MixpanelRegion
}

export function credentialsFromBinding(binding: MixpanelAccountBinding): MixpanelCredentials {
  return {
    username: binding.username,
    secret: decryptMixpanelSecret(binding.encryptedSecret),
    region: binding.region,
  }
}

export function mixpanelHosts(region: MixpanelRegion) {
  return HOSTS[region]
}

/** Verify a service account by issuing a cheap read; surfaces 401 distinctly. */
export async function verifyMixpanelCredentials(creds: MixpanelCredentials): Promise<void> {
  const basic = Buffer.from(`${creds.username}:${creds.secret}`).toString('base64')
  const res = await fetch(`${HOSTS[creds.region].apiHost}/api/app/me`, {
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (res.ok) return

  // Mixpanel answers {"status": "error", "error": …} on failures, but a proxy
  // in front of it may return a bare text body; handle both.
  let detail = `HTTP ${String(res.status)}`
  const body = await res.text().catch(() => '')

  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string }

      detail = parsed.error || body
    } catch {
      detail = body
    }
  }
  throw new MixpanelApiError(res.status, `Mixpanel API error: ${detail}`)
}
