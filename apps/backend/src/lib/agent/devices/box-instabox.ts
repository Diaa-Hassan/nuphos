// A Box: a cloud machine Nuphos orders on instabox for a person, which joins as
// that person's device with a one-time token and then behaves like any other
// computer of theirs. One partner key for the deployment; every machine is
// created with `vault: false`, so none of the account's secrets reach it.

import { randomUUID } from 'node:crypto'

import { InstaboxError, Sandbox } from '@insforge/instabox-sdk'

import { config } from '@/config'
import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { issueDeviceJoinToken } from './join-tokens'
import { isDevicePresent } from './presence'
import {
  countAgentDeviceBoxes,
  getAgentDevice,
  insertBoxAgentDevice,
  setAgentDeviceBoxSandbox,
  setAgentDeviceBoxState,
} from './store'

import type { AgentDevice, AgentDeviceBox } from './store'

export const BOX_TEMPLATE = 'universal'
/** Machines one person may have at a time, on the deployment's own key. */
export const MAX_BOXES_PER_USER = 2
/** The machine joins within this; a token left unused expires with it. */
const JOIN_TOKEN_TTL_SEC = 60 * 60
/** Installing the CLI and the agents on a fresh machine. */
const INSTALL_TIMEOUT_MS = 9 * 60_000
/** Ordering a machine, in the background. */
const CREATE_TIMEOUT_MS = 3 * 60_000
/** Anything on a turn's path: an instabox outage must not stall a conversation for long. */
const QUICK_TIMEOUT_MS = 30_000
/** How long a resume may take before the tunnel is back. */
const WAKE_TIMEOUT_MS = 45_000

/** Node 22 and the agents, then the CLI; idempotent, so a resume can run it again. */
export const BOX_INSTALL_COMMAND = [
  'set -e',
  'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"',
  'if ! node -e "process.exit(+process.versions.node.split(\'.\')[0] >= 22 ? 0 : 1)" 2>/dev/null; then',
  '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs',
  'fi',
  'npm config set prefix "$HOME/.npm-global" && npm i -g @anthropic-ai/claude-code @openai/codex',
  'command -v nuphos >/dev/null || curl -fsSL https://nuphos.ai/install | sh',
].join('\n')

/** Starts the host detached from the command session; it keeps the Box's own credential. */
const AGENT_COMMAND =
  'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"; pgrep -x nuphos >/dev/null || setsid nohup nuphos agent >> "$HOME/nuphos-agent.log" 2>&1 < /dev/null &'

type BoxDevice = AgentDevice & { box: AgentDeviceBox }

function connection(timeoutMs: number) {
  const box = config.box.instabox

  if (!box) throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

  return { ...box, requestTimeoutMs: timeoutMs, operationTimeoutMs: timeoutMs }
}

export function boxesEnabled(): boolean {
  return config.box.instabox !== null
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
const unavailable = (what: string, error: unknown) =>
  new AppError(503, 'box_unavailable', `${what}: ${reason(error)}`)

function requireBox(device: AgentDevice | null, deviceId: string): BoxDevice {
  if (!device?.box) throw new AppError(404, 'not_found', `No Box ${deviceId}`)

  return device as BoxDevice
}

function requireMachine(device: BoxDevice): string {
  if (device.box.state === 'creating' || !device.box.sandboxId)
    throw new AppError(409, 'box_state', 'The Box is still being created')
  if (device.box.state === 'error')
    throw new AppError(409, 'box_state', 'The Box failed to set up; delete it and make a new one')

  return device.box.sandboxId
}

function backendUrl(): string {
  const url = publicBackendUrl()

  if (!url)
    throw new AppError(
      503,
      'box_unavailable',
      'This deployment has no public URL for a Box to reach',
    )

  return url
}

/** Deletes a machine, treating one that is already gone as deleted. */
async function kill(sandboxId: string): Promise<void> {
  try {
    await Sandbox.kill(sandboxId, connection(QUICK_TIMEOUT_MS))
  } catch (error) {
    if (error instanceof InstaboxError && error.status === 404) return
    throw error
  }
}

/**
 * Registers the device row at once (state `creating`) and returns; ordering,
 * installing and joining run in the background. The row turns `running` when the
 * host joins, or `error` with the reason, and a machine whose setup failed is
 * deleted again.
 */
export async function createBox(
  userId: string,
  teamId: string,
  label: string,
): Promise<AgentDevice> {
  connection(QUICK_TIMEOUT_MS)
  const url = backendUrl()

  if ((await countAgentDeviceBoxes(userId)) >= MAX_BOXES_PER_USER)
    throw new AppError(
      409,
      'box_limit',
      `You already have ${String(MAX_BOXES_PER_USER)} Boxes; delete one first`,
    )
  const deviceId = randomUUID()
  const now = new Date()
  const registration = {
    deviceId,
    label,
    platform: 'linux',
    allowLocalExec: true,
    box: { provider: 'instabox' as const, state: 'creating' as const, updatedAt: now },
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
    if (!(await setAgentDeviceBoxSandbox(userId, deviceId, sandbox.sandboxId))) {
      await kill(sandbox.sandboxId)

      return
    }
    const { token } = await issueDeviceJoinToken(userId, {
      label,
      deviceId,
      expiresInSec: JOIN_TOKEN_TTL_SEC,
    })

    await sandbox.commands.run(BOX_INSTALL_COMMAND, { timeoutMs: INSTALL_TIMEOUT_MS })
    // The token rides in the environment of this one command: not on disk, not in argv.
    await sandbox.commands.run(AGENT_COMMAND, {
      envs: { NUPHOS_JOIN_TOKEN: token, NUPHOS_API_URL: url },
      timeoutMs: QUICK_TIMEOUT_MS,
    })
    logEvent('info', 'agent.box.provisioned', { user_id: userId, device_id: deviceId })
  } catch (error) {
    logError('agent.box.provision_failed', error, { user_id: userId, device_id: deviceId })
    await setAgentDeviceBoxState(userId, deviceId, 'error', reason(error).slice(0, 500))
    // A machine that never joined would otherwise run, and bill, until someone notices.
    if (sandbox) await kill(sandbox.sandboxId).catch(() => undefined)
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
  await setAgentDeviceBoxState(userId, deviceId, 'paused')

  return requireBox(await getAgentDevice(userId, deviceId), deviceId)
}

/**
 * Resumes the machine, whatever paused it (Nuphos, or instabox after 30 idle
 * minutes), and makes sure the host runs: a machine resumed from a stop has lost
 * its processes. The real state comes from instabox, not from the row.
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
      envs: { NUPHOS_API_URL: url },
      timeoutMs: QUICK_TIMEOUT_MS,
    })
  } catch (error) {
    throw unavailable('Could not resume the Box', error)
  }
  await setAgentDeviceBoxState(userId, deviceId, 'running')

  return requireBox(await getAgentDevice(userId, deviceId), deviceId)
}

/** Deletes the machine and its disks; the caller removes the device row. A row without a machine, or whose machine is already gone, just goes. */
export async function destroyBox(userId: string, deviceId: string): Promise<void> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)

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
 * time. A Box still being created, or broken, is not woken.
 */
export async function wakeBox(userId: string, deviceId: string): Promise<boolean> {
  if (await isDevicePresent(userId, deviceId)) return true
  const device = await getAgentDevice(userId, deviceId)

  if (!device?.box?.sandboxId || device.box.state === 'creating' || device.box.state === 'error')
    return false
  await resumeBox(userId, deviceId)
  const deadline = Date.now() + WAKE_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await isDevicePresent(userId, deviceId)) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  return false
}
