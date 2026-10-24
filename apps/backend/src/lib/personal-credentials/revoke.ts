import { logError } from '@/lib/observability'

import { revokeGithubToken } from './github'
import { isGoogleProvider, revokeGoogleToken } from './google'
import { open } from './seal'

import type { PersonalCredential } from '@/models'

const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke'

async function revokeAtProvider(doc: PersonalCredential): Promise<void> {
  const token = open(doc.provider, doc.encryptedAccessToken)

  if (doc.provider === 'github') return revokeGithubToken(token)
  if (isGoogleProvider(doc.provider)) return revokeGoogleToken(token)
  await fetch(LINEAR_REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
}

/** Best-effort: deletes the grant at its provider. */
export function revokeQuietly(doc: PersonalCredential): Promise<void> {
  return revokeAtProvider(doc).catch((error: unknown) => {
    logError('personal_credential.revoke_failed', error, { provider: doc.provider })
  })
}
