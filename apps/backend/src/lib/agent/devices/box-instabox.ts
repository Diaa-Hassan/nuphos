// A Box: a cloud machine Nuphos orders on instabox for a person, which joins as
// that person's device with a one-time token and then behaves like any other
// computer of theirs. One partner key for the deployment; every machine is
// created with `vault: false`, so none of the account's secrets reach it.
//
// The row stores only which machine it is. Its state comes from instabox and
// from the device's presence, so a machine that instabox paused on its own is
// seen, and woken, like one Nuphos paused.

import { randomUUID } from 'node:crypto'

import { Sandbox } from '@insforge/instabox-sdk'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import {
  AGENT_COMMAND,
  BOX_INSTALL_COMMAND,
  CREATE_TIMEOUT_MS,
  INSTALL_TIMEOUT_MS,
  QUICK_TIMEOUT_MS,
  boxBackendUrl,
  connection,
  kill,
  unavailable,
} from './box-instabox-client'

import { deleteDeviceJoinTokens, issueDeviceJoinToken } from './join-tokens'
import { isDevicePresent } from './presence'
import {
  countAgentDeviceBoxes,
  countTeamBoxes,
  deleteAgentDevice,
  getAgentDevice,
  insertBoxAgentDevice,
  setAgentDeviceBoxSandbox,
} from './store'

import type { AgentDevice, AgentDeviceBox } from './store'

export { boxBackendUrl, boxesAvailable, boxesEnabled } from './box-instabox-client'
export { boxState } from './box-instabox-state'
export type { BoxState } from './box-instabox-state'

export const BOX_TEMPLATE = 'universal'
/** Machines one team may have at a time, on the deployment's own key. */
export const MAX_BOXES_PER_TEAM = 3
/** Orders one person may place in `CREATE_WINDOW_MS`. */
export const MAX_CREATES_PER_WINDOW = 3
const CREATE_WINDOW_MS = 10 * 60_000
/** The machine joins within this; a token left unused expires with it. */
const JOIN_TOKEN_TTL_SEC = 60 * 60
/** How long a resume may take before the tunnel is back. */
const WAKE_TIMEOUT_MS = 60_000
/** How long a fresh machine may take to join after its host was started. */
const JOIN_TIMEOUT_MS = 3 * 60_000

type BoxDevice = AgentDevice & { box: AgentDeviceBox }

function requireBox(device: AgentDevice | null, deviceId: string): BoxDevice {
  if (!device?.box) throw new AppError(404, 'not_found', `No Box ${deviceId}`)

  return device as BoxDevice
}

function requireMachine(device: BoxDevice): string {
  if (!device.box.sandboxId) throw new AppError(409, 'box_state', 'The Box is still being created')

  return device.box.sandboxId
}

/** The CLI and its runtime bundle come from the release, or from a mirror in development. */
function downloadEnv(): Record<string, string> {
  return config.box.downloadUrl ? { NUPHOS_DOWNLOAD_URL: config.box.downloadUrl } : {}
}

function backendUrl(): string {
  const url = boxBackendUrl()

  if (!url)
    throw new AppError(
      503,
      'box_unavailable',
      'This deployment has no public URL for a Box to reach',
    )

  return url
}

async function killByDevice(deviceId: string): Promise<void> {
  const machines = await Sandbox.list({ ...connection(QUICK_TIMEOUT_MS), metadata: { deviceId } })

  for (const machine of machines) await kill(machine.sandboxId)
}

const recentCreates = new Map<string, number[]>()

function checkCreateRate(userId: string): void {
  const now = Date.now()
  const recent = (recentCreates.get(userId) ?? []).filter((at) => now - at < CREATE_WINDOW_MS)

  if (recent.length >= MAX_CREATES_PER_WINDOW)
    throw new AppError(429, 'box_rate_limited', 'Too many Boxes ordered recently; try again later')
  recentCreates.set(userId, [...recent, now])
}

/**
 * Registers the device row at once and returns; ordering, installing and
 * joining run in the background. The row shows `creating` until the host joins.
 * If any step fails, the machine, the row and its token are removed again.
 */
export async function createBox(
  userId: string,
  teamId: string,
  label: string,
): Promise<AgentDevice> {
  const url = backendUrl()

  if ((await countTeamBoxes(teamId)) >= MAX_BOXES_PER_TEAM)
    throw new AppError(
      409,
      'box_limit',
      `This team already has ${String(MAX_BOXES_PER_TEAM)} Boxes; delete one first`,
    )
  checkCreateRate(userId)
  const deviceId = randomUUID()
  const now = new Date()
  const registration = {
    deviceId,
    label,
    platform: 'linux',
    allowLocalExec: true,
    box: { provider: 'instabox' as const, teamId },
  }

  await insertBoxAgentDevice(userId, registration)
  void order(userId, teamId, deviceId, label, url)

  return { ...registration, userId, createdAt: now, updatedAt: now }
}

async function order(
  userId: string,
  teamId: string,
  deviceId: string,
  label: string,
  url: string,
): Promise<void> {
  let sandbox: Sandbox | undefined

  try {
    sandbox = await Sandbox.create(BOX_TEMPLATE, {
      ...connection(CREATE_TIMEOUT_MS),
      name: `nuphos-${deviceId.slice(0, 8)}`,
      metadata: { teamId, deviceId, createdBy: userId },
      vault: false,
    })
    // Deleted while it was being ordered: the machine must not outlive the row.
    if (!(await setAgentDeviceBoxSandbox(userId, deviceId, sandbox.sandboxId)))
      throw new Error('The Box was deleted while it was being created')
    const { token } = await issueDeviceJoinToken(userId, {
      label,
      deviceId,
      expiresInSec: JOIN_TOKEN_TTL_SEC,
    })

    await sandbox.commands.run(BOX_INSTALL_COMMAND, {
      envs: downloadEnv(),
      timeoutMs: INSTALL_TIMEOUT_MS,
    })
    // The token rides in the environment of this one command: not on disk, not in argv.
    await sandbox.commands.run(AGENT_COMMAND, {
      envs: { ...downloadEnv(), NUPHOS_JOIN_TOKEN: token, NUPHOS_API_URL: url },
      timeoutMs: QUICK_TIMEOUT_MS,
    })
    // Setup is done when the machine is actually here, not when its commands returned.
    if (!(await present(userId, deviceId, JOIN_TIMEOUT_MS)))
      throw new Error('The machine did not join within the time allowed')
    logEvent('info', 'agent.box.provisioned', { user_id: userId, device_id: deviceId })
  } catch (error) {
    logError('agent.box.provision_failed', error, { user_id: userId, device_id: deviceId })
    // Nothing half-made stays: no machine to bill, no row to confuse, no token to find.
    // A create that timed out on our side may still have produced a machine: it is
    // found by the device id in its metadata.
    await (sandbox ? kill(sandbox.sandboxId) : killByDevice(deviceId)).catch(() => undefined)
    await deleteDeviceJoinTokens(deviceId).catch(() => undefined)
    await deleteAgentDevice(userId, deviceId).catch(() => undefined)
  }
}

export async function pauseBox(userId: string, deviceId: string): Promise<AgentDevice> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)
  const sandboxId = requireMachine(device)

  try {
    const sandbox = await Sandbox.connect(sandboxId, {
      ...connection(QUICK_TIMEOUT_MS),
      resume: false,
    })

    await sandbox.pause()
  } catch (error) {
    throw unavailable('Could not pause the Box', error)
  }

  return device
}

/**
 * Resumes the machine, whatever paused it (Nuphos, or instabox after 30 idle
 * minutes), and makes sure the host runs: a machine resumed from a stop has lost
 * its processes.
 */
export async function resumeBox(userId: string, deviceId: string): Promise<AgentDevice> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)
  const sandboxId = requireMachine(device)
  const url = backendUrl()

  try {
    const sandbox = await Sandbox.connect(sandboxId, {
      ...connection(QUICK_TIMEOUT_MS),
      resume: true,
    })

    await sandbox.commands.run(AGENT_COMMAND, {
      envs: { ...downloadEnv(), NUPHOS_API_URL: url },
      timeoutMs: QUICK_TIMEOUT_MS,
    })
  } catch (error) {
    throw unavailable('Could not resume the Box', error)
  }

  return device
}

/** Deletes the machine and its disks; the caller removes the device row. A row without a machine, or whose machine is already gone, just goes. */
export async function destroyBox(userId: string, deviceId: string): Promise<void> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)

  await deleteDeviceJoinTokens(deviceId)
  if (!device.box.sandboxId) return
  try {
    await kill(device.box.sandboxId)
  } catch (error) {
    logError('agent.box.kill_failed', error, { user_id: userId, device_id: deviceId })
    throw unavailable('Could not delete the Box', error)
  }
}

/**
 * An offline Box that a turn or a command needs is resumed first, and this waits
 * for its tunnel. True once the Box is present; false when it did not come back in
 * time. A Box still being created is not woken.
 */
export async function wakeBox(userId: string, deviceId: string): Promise<boolean> {
  if (await isDevicePresent(userId, deviceId)) return true
  const device = await getAgentDevice(userId, deviceId)

  if (!device?.box?.sandboxId) return false
  await resumeBox(userId, deviceId)

  return present(userId, deviceId, WAKE_TIMEOUT_MS)
}

/** Polls the device's presence until it is here or the time is up. */
async function present(userId: string, deviceId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await isDevicePresent(userId, deviceId)) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  return false
}
