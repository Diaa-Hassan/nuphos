import { buildAtlasError } from './error.ts'
import { call, readToken } from './client.ts'

import type { AgentDevice, AgentDeviceList, BoxUsage } from '../../src/api/device-types.ts'

// Boxes are personal: the routes act on the signed-in user's own devices.
const box = (deviceId: string) => `/agent/devices/${encodeURIComponent(deviceId)}/box`

export function listAgentDevices(): Promise<AgentDeviceList> {
  return call('GET', '/agent/devices')
}
/** A Box is made inside one of the user's teams. */
export function createBox(teamId: string, label?: string): Promise<AgentDevice> {
  return call('POST', '/agent/devices/boxes', label ? { teamId, label } : { teamId }, {
    retry: false,
  })
}
export function pauseBox(deviceId: string): Promise<AgentDevice> {
  return call('POST', `${box(deviceId)}/pause`, undefined, { retry: false })
}
export function resumeBox(deviceId: string): Promise<AgentDevice> {
  return call('POST', `${box(deviceId)}/resume`, undefined, { retry: false })
}
export function deleteBox(deviceId: string): Promise<{ ok: true }> {
  return call('DELETE', box(deviceId), undefined, { retry: false })
}

export function getBoxUsage(teamId: string): Promise<BoxUsage> {
  return call('GET', `/teams/${encodeURIComponent(teamId)}/box-usage`)
}

/** What the billing service's errors (`{ error }` only) mean to the user. */
const BILLING_ERRORS: Record<string, string> = {
  checkout_in_progress: 'A checkout for this team is already in progress; try again shortly',
  forbidden: 'Only team administrators can change the Box plan',
}

/**
 * A billing page to open: the portal for a subscribed team, else Checkout for a
 * `vcpus` plan. The billing service is a separate origin whose CORS takes only
 * Authorization and Content-Type, hence a plain fetch.
 */
export async function boxBillingPage(teamId: string, vcpus?: number): Promise<{ url: string }> {
  const { billingUrl, subscribed } = await getBoxUsage(teamId)

  if (!billingUrl) throw new Error('This deployment has no billing service')
  const post = async (page: string, body?: unknown) =>
    fetch(`${billingUrl}/teams/${encodeURIComponent(teamId)}/${page}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(await readToken()) ?? ''}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  let response =
    subscribed || vcpus === undefined
      ? await post('portal')
      : await post('checkout', { plan: `nuphos_box_${String(vcpus)}vcpu_monthly` })

  const failure = async () =>
    response.ok ? undefined : ((await response.json().catch(() => ({}))) as { error?: string })
  let error = (await failure())?.error

  // Subscribed since the usage was read: change the plan in the portal.
  if (error === 'already_subscribed') {
    response = await post('portal')
    error = (await failure())?.error
  }
  if (!response.ok)
    throw buildAtlasError(
      BILLING_ERRORS[error ?? ''] ?? `Billing answered ${String(response.status)}`,
      error ?? 'billing_error',
    )

  return (await response.json()) as { url: string }
}
