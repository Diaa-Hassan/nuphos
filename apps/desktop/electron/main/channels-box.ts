import { createBox, deleteBox, listAgentDevices, pauseBox, resumeBox } from '../atlas/boxes.ts'

export const boxChannels = {
  'box:listDevices': () => listAgentDevices(),
  'box:create': (_e: unknown, label?: string) => createBox(label),
  'box:pause': (_e: unknown, deviceId: string) => pauseBox(deviceId),
  'box:resume': (_e: unknown, deviceId: string) => resumeBox(deviceId),
  'box:delete': (_e: unknown, deviceId: string) => deleteBox(deviceId),
}
