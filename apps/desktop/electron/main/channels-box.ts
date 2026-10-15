import {
  boxJoinToken,
  createBox,
  deleteBox,
  listAgentDevices,
  pauseBox,
  resumeBox,
} from '../atlas/boxes.ts'

function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string')

  return value
}

export const boxChannels = {
  'box:listDevices': () => listAgentDevices(),
  'box:create': (_e: unknown, teamId: unknown, label?: unknown) =>
    createBox(text(teamId), label === undefined ? undefined : text(label)),
  'box:pause': (_e: unknown, deviceId: unknown) => pauseBox(text(deviceId)),
  'box:resume': (_e: unknown, deviceId: unknown) => resumeBox(text(deviceId)),
  'box:delete': (_e: unknown, deviceId: unknown) => deleteBox(text(deviceId)),
  'box:join-token': () => boxJoinToken(),
}
