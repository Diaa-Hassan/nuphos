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
 * Every machine that runs the user's agents: all Boxes and every online computer. A computer that
 * signed in again leaves its old record behind under the same name; an offline record shows only
 * when no record of that machine is online, and then only the newest.
 */
export function machines(devices: AgentDevice[]): AgentDevice[] {
  const key = (device: AgentDevice) => `${device.platform}\n${device.label}`
  const live = new Set(devices.filter((device) => device.online).map(key))
  const newest = new Map<string, AgentDevice>()

  for (const device of devices) {
    if (device.box || device.online || live.has(key(device))) continue
    const kept = newest.get(key(device))

    if (!kept || (device.createdAt ?? '') > (kept.createdAt ?? '')) newest.set(key(device), device)
  }

  return devices.filter(
    (device) => device.box || device.online || newest.get(key(device)) === device,
  )
}

export type MachineKind = 'box' | 'laptop' | 'desktop'

const MAC_MODEL = /MacBook (?:Pro|Air)|MacBook|Mac mini|Mac Studio|Mac Pro|iMac/i
const PLATFORM_NAME: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }

export function machineKind(device: AgentDevice): MachineKind {
  if (device.box) return 'box'
  const model = MAC_MODEL.exec(device.label)?.[0] ?? ''

  return /MacBook/i.test(model) || (!model && device.platform !== 'linux') ? 'laptop' : 'desktop'
}

/** "macOS · MacBook Pro · 2 agents"; a Box being made says how long it takes instead. */
export function machineDetail(device: AgentDevice, agentCount: number): string {
  if (device.box?.state === 'creating') return 'Starting the computer, usually 10–30 seconds…'
  const parts = device.box
    ? ['Box']
    : [PLATFORM_NAME[device.platform] ?? device.platform, MAC_MODEL.exec(device.label)?.[0]]

  if (agentCount > 0) parts.push(`${agentCount} agent${agentCount === 1 ? '' : 's'}`)

  return parts.filter(Boolean).join(' · ')
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
