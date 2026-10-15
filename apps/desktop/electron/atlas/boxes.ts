import { call } from './client.ts'

import type { AgentDevice, AgentDeviceList, BoxPlanStatus } from '../../src/api/device-types.ts'

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
/** The team's Box plan and its running vCPUs; checkout and portal answer a page to open. */
const plan = (teamId: string) => `/teams/${encodeURIComponent(teamId)}/box-plan`

export function getBoxPlan(teamId: string): Promise<BoxPlanStatus> {
  return call('GET', plan(teamId))
}
export function boxPlanCheckout(teamId: string, planId: string): Promise<{ url: string }> {
  return call('POST', `${plan(teamId)}/checkout`, { plan: planId }, { retry: false })
}
export function boxPlanPortal(teamId: string): Promise<{ url: string }> {
  return call('POST', `${plan(teamId)}/portal`, undefined, { retry: false })
}
export function deleteBox(deviceId: string): Promise<{ ok: true }> {
  return call('DELETE', box(deviceId), undefined, { retry: false })
}
