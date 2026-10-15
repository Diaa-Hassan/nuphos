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

  // Subscribed since the usage was read: change the plan in the portal.
  if (response.status === 409) response = await post('portal')
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string
      message?: string
    }

    throw buildAtlasError(
      failure.message ?? `Billing answered ${String(response.status)}`,
      failure.error ?? 'billing_error',
    )
  }

  return (await response.json()) as { url: string }
}
