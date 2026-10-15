import type { RuntimeStatusView } from './runtimePresentation'
import type { AgentDevice, BoxState, BoxStatus, BoxUsage } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export type BoxDevice = AgentDevice & { box: BoxStatus }

// Only a Box being set up changes without the user acting: it comes online in 10–30 s.
export const BOX_CREATING_POLL_MS = 2_000

export const BOX_BADGE: Record<BoxState, RuntimeStatusView> = {
  creating: { label: 'Creating', tone: 'pending' },
  running: { label: 'Running', tone: 'online' },
  paused: { label: 'Paused', tone: 'off' },
  error: { label: 'Error', tone: 'error' },
}

/** What can be done to a Box in each state; the backend answers 409 otherwise, and a failed Box can only be deleted. */
export function boxActions(state: BoxState): { pause: boolean; resume: boolean } {
  return { pause: state === 'running', resume: state === 'paused' }
}

export function boxes(devices: AgentDevice[]): BoxDevice[] {
  return devices.filter((device): device is BoxDevice => device.box !== undefined)
}

/** A machine that runs but whose agent has not connected yet is still being set up. */
export function boxState(device: BoxDevice): BoxState {
  return device.box.state === 'running' && device.online === false ? 'creating' : device.box.state
}

export function anyCreating(devices: AgentDevice[]): boolean {
  return boxes(devices).some((device) => boxState(device) === 'creating')
}

/** The team's agents that run on this Box. */
export function boxAgents(deviceId: string, instances: RuntimeInstance[]): RuntimeInstance[] {
  return instances.filter(
    (instance) => instance.kind === 'local' && instance.local?.deviceId === deviceId,
  )
}

export type BoxSetupPhase = 'idle' | 'starting' | 'ready' | 'error'

/** Where a Box made by a setup flow stands: up once the team lists one of its agents. */
export function boxSetupPhase(
  deviceId: string | null,
  devices: AgentDevice[] | null,
  agents: RuntimeInstance[],
): BoxSetupPhase {
  if (!deviceId) return 'idle'
  if (agents.length > 0) return 'ready'
  const device = boxes(devices ?? []).find((candidate) => candidate.deviceId === deviceId)

  return device?.box.state === 'error' ? 'error' : 'starting'
}

/** The vCPU sizes the billing service sells, smallest first. */
export const BOX_VCPU_TIERS = [4, 12, 24]

/** Why the team's vCPU limit keeps a new Box from starting; null when one can start. */
export function newBoxBlockedReason(usage: BoxUsage | null, isAdmin: boolean): string | null {
  if (usage?.limitVcpus === 0)
    return isAdmin
      ? 'Your team has no Box plan yet. Upgrade to start a Box.'
      : 'Ask a team administrator to add a Box plan.'
  if (usage?.limitVcpus == null || usage.usedVcpus === null || usage.boxVcpus === null) return null
  if (usage.usedVcpus + usage.boxVcpus <= usage.limitVcpus) return null

  return `Your running Boxes use ${String(usage.usedVcpus)} of ${String(usage.limitVcpus)} vCPU, and a new Box needs ${String(usage.boxVcpus)}. Pause a Box or upgrade.`
}
