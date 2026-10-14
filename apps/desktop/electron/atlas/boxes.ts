import { call } from './client.ts'

import type { AgentDevice, AgentDeviceList } from '../../src/api/device-types.ts'

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
