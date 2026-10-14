import { call } from './client.ts'

import type { AgentDevice, AgentDeviceList, BoxStatus } from '../../src/api/device-types.ts'

// Boxes are personal: the routes act on the signed-in user's own devices, in any team.
const box = (deviceId: string) => `/agent/devices/${encodeURIComponent(deviceId)}/box`

export function listAgentDevices(): Promise<AgentDeviceList> {
  return call('GET', '/agent/devices')
}
export function createBox(label?: string): Promise<AgentDevice> {
  return call('POST', '/agent/devices/boxes', label ? { label } : {}, { retry: false })
}
export function pauseBox(deviceId: string): Promise<{ box: BoxStatus }> {
  return call('POST', `${box(deviceId)}/pause`, undefined, { retry: false })
}
export function resumeBox(deviceId: string): Promise<{ box: BoxStatus }> {
  return call('POST', `${box(deviceId)}/resume`, undefined, { retry: false })
}
export function deleteBox(deviceId: string): Promise<{ ok: true }> {
  return call('DELETE', box(deviceId), undefined, { retry: false })
}
