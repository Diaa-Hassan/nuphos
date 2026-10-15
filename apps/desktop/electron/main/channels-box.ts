import {
  boxDesktop,
  boxJoinToken,
  createBox,
  createDeviceAgent,
  deleteBox,
  renameBox,
  listAgentDevices,
  pauseBox,
  resumeBox,
} from '../atlas/boxes.ts'

import type { AgentDeviceListOptions, LocalAgentProvider } from '../../src/api/device-types.ts'

export const boxChannels = {
  'box:listDevices': (_e?: unknown, options?: AgentDeviceListOptions) => listAgentDevices(options),
  'box:create': (_e: unknown, label?: string, teamId?: string) => createBox(label, teamId),
  'box:createAgent': (
    _e: unknown,
    deviceId: string,
    teamId: string,
    provider: LocalAgentProvider,
  ) => createDeviceAgent(deviceId, teamId, provider),
  'box:pause': (_e: unknown, deviceId: string) => pauseBox(deviceId),
  'box:resume': (_e: unknown, deviceId: string) => resumeBox(deviceId),
  'box:delete': (_e: unknown, deviceId: string) => deleteBox(deviceId),
  'box:desktop': (_e: unknown, deviceId: string) => boxDesktop(deviceId),
  'box:join-token': () => boxJoinToken(),
  'box:rename': (_e: unknown, deviceId: string, label: string) => renameBox(deviceId, label),
}
