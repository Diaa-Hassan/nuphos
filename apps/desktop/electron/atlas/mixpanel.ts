import { call } from './client'

import type { BindingAccess } from './teams'

export type MixpanelAccount = {
  id: string
  label: string
  username: string
  region: 'us' | 'eu' | 'in'
  createdAt?: string
}

export async function listMixpanelAccounts(teamId: string): Promise<MixpanelAccount[]> {
  const data = await call<{ accounts: MixpanelAccount[] }>(
    'GET',
    `/teams/${teamId}/mixpanel-accounts`,
  )

  return data.accounts ?? []
}

export async function bindMixpanelAccount(
  teamId: string,
  label: string,
  username: string,
  secret: string,
  region: MixpanelAccount['region'],
): Promise<MixpanelAccount> {
  return call<MixpanelAccount>(
    'POST',
    `/teams/${teamId}/mixpanel-accounts`,
    { label, username, secret, region },
    { retry: false },
  )
}

export async function unbindMixpanelAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/mixpanel-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

export async function getMixpanelAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/mixpanel-accounts/${accountId}/access`)
}

export async function updateMixpanelAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'PUT',
    `/teams/${teamId}/mixpanel-accounts/${accountId}/access`,
    access,
  )
}
