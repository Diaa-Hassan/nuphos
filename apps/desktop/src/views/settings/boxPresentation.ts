import type { RuntimeStatusView } from './runtimePresentation'
import type { AgentDevice, BoxState, BoxStatus } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export type BoxDevice = AgentDevice & { box: BoxStatus }

// Only a Box being set up changes without the user acting: it comes online in 10–30 s.
export const BOX_CREATING_POLL_MS = 2_000
// A Box still creating after this long will not come up.
export const BOX_SETUP_TIMEOUT_MS = 5 * 60_000

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

/**
 * Every machine that runs the user's agents: all Boxes, and one row per own computer.
 * A computer that signed in again leaves its old record behind under the same name; the online
 * or newest one is the current one.
 */
export function machines(devices: AgentDevice[]): AgentDevice[] {
  const current = new Map<string, AgentDevice>()
  const rank = (device: AgentDevice) => [device.online ? 1 : 0, device.createdAt ?? ''] as const

  for (const device of devices) {
    const key = device.box ? device.deviceId : `${device.platform}\n${device.label}`
    const kept = current.get(key)
    const [online, created] = rank(device)
    const [keptOnline, keptCreated] = kept ? rank(kept) : [-1, '']

    if (online > keptOnline || (online === keptOnline && created > keptCreated))
      current.set(key, device)
  }

  return devices.filter((device) => [...current.values()].includes(device))
}

export function anyCreating(devices: AgentDevice[]): boolean {
  return boxes(devices).some((device) => device.box.state === 'creating')
}

/** Boxes that were creating and are gone: #355 drops a Box whose machine could not be made. */
export function vanishedBoxes(previous: AgentDevice[], next: AgentDevice[]): BoxDevice[] {
  const ids = new Set(next.map((device) => device.deviceId))

  return boxes(previous).filter(
    (device) => device.box.state === 'creating' && !ids.has(device.deviceId),
  )
}

/** The team's agents that run on this machine. */
export function boxAgents(deviceId: string, instances: RuntimeInstance[]): RuntimeInstance[] {
  return instances.filter(
    (instance) => instance.kind === 'local' && instance.local?.deviceId === deviceId,
  )
}

export type BoxSetupPhase = 'idle' | 'starting' | 'ready' | 'error' | 'timeout'

/** Where a Box made by a setup flow stands: up once the team lists one of its agents. */
export function boxSetupPhase(
  deviceId: string | null,
  devices: AgentDevice[] | null,
  agents: RuntimeInstance[],
  now = Date.now(),
): BoxSetupPhase {
  if (!deviceId) return 'idle'
  if (agents.length > 0) return 'ready'
  if (!devices) return 'starting'
  const device = boxes(devices).find((candidate) => candidate.deviceId === deviceId)

  if (!device || device.box.state === 'error') return 'error'
  const created = Date.parse(device.createdAt ?? '')

  return now - created > BOX_SETUP_TIMEOUT_MS ? 'timeout' : 'starting'
}

/** Why a setup flow's Box did not come up, or null while it still may. */
export function boxSetupProblem(phase: BoxSetupPhase): string | null {
  if (phase === 'error')
    return 'The Box could not start. Delete it in Settings › Agents and try again.'
  if (phase === 'timeout')
    return 'The Box has not started after 5 minutes. Delete it in Settings › Agents and try again.'

  return null
}
