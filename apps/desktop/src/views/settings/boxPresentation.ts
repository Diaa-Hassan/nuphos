import type { RuntimeStatusView } from './runtimePresentation'
import type { AgentDevice, BoxState, BoxStatus } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export type BoxDevice = AgentDevice & { box: BoxStatus }

// Only a Box being created changes without the user acting: it comes online in 10–30 s.
export const BOX_CREATING_POLL_MS = 2_000

export const BOX_BADGE: Record<BoxState, RuntimeStatusView> = {
  creating: { label: 'Creating', tone: 'pending' },
  running: { label: 'Running', tone: 'online' },
  paused: { label: 'Paused', tone: 'off' },
  error: { label: 'Error', tone: 'error' },
}

/** What can be done to a Box in each state; the backend answers 409 otherwise. */
export function boxActions(state: BoxState): { pause: boolean; resume: boolean } {
  return { pause: state === 'running', resume: state === 'paused' || state === 'error' }
}

export function boxes(devices: AgentDevice[]): BoxDevice[] {
  return devices.filter((device): device is BoxDevice => device.box !== undefined)
}

export function anyCreating(devices: AgentDevice[]): boolean {
  return devices.some((device) => device.box?.state === 'creating')
}

/** The team's agents that run on this Box. */
export function boxAgents(deviceId: string, instances: RuntimeInstance[]): RuntimeInstance[] {
  return instances.filter(
    (instance) => instance.kind === 'local' && instance.local?.deviceId === deviceId,
  )
}
