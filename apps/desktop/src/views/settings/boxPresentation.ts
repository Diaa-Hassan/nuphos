import type { RuntimeStatusView } from './runtimePresentation'
import type { AgentDevice, BoxState } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export const BOX_POLL_MS = 10_000
// A Box comes online 10–30 s after it is created, so watch it closely until then.
export const BOX_CREATING_POLL_MS = 2_000

export const BOX_BADGE: Record<BoxState, RuntimeStatusView> = {
  creating: { label: 'Creating', tone: 'pending' },
  running: { label: 'Running', tone: 'online' },
  paused: { label: 'Paused', tone: 'off' },
  stopped: { label: 'Stopped', tone: 'off' },
  error: { label: 'Error', tone: 'error' },
}

/** What can be done to a Box in each state; the backend answers 409 otherwise. */
export function boxActions(state: BoxState): { pause: boolean; resume: boolean } {
  return { pause: state === 'running', resume: state === 'paused' || state === 'stopped' }
}

export function boxes(
  devices: AgentDevice[],
): (AgentDevice & Required<Pick<AgentDevice, 'box'>>)[] {
  return devices.filter((device) => device.box !== undefined) as (AgentDevice &
    Required<Pick<AgentDevice, 'box'>>)[]
}

export function boxPollMs(devices: AgentDevice[]): number {
  return devices.some((device) => device.box?.state === 'creating')
    ? BOX_CREATING_POLL_MS
    : BOX_POLL_MS
}

/** The team's agents that run on this Box. */
export function boxAgents(deviceId: string, instances: RuntimeInstance[]): RuntimeInstance[] {
  return instances.filter(
    (instance) => instance.kind === 'local' && instance.local?.deviceId === deviceId,
  )
}
