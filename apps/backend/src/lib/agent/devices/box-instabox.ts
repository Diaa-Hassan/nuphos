// A Box: a cloud machine Nuphos orders on instabox for a person, which joins as
// that person's device with a one-time token and then behaves like any other
// computer of theirs. One partner key for the deployment; every machine is
// created with `vault: false`, so none of the account's secrets reach it.

import { randomUUID } from 'node:crypto'

import { Sandbox } from '@insforge/instabox-sdk'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { issueDeviceJoinToken } from './join-tokens'
import { isDevicePresent } from './presence'
import { getAgentDevice, insertBoxAgentDevice, setAgentDeviceBoxState } from './store'

import type { AgentDevice, AgentDeviceBoxState } from './store'

export const BOX_TEMPLATE = 'universal'
/** The machine joins within this; a token left unused expires with it. */
const JOIN_TOKEN_TTL_SEC = 60 * 60
/** Installing the CLI and the agents on a fresh machine. */
const INSTALL_TIMEOUT_MS = 9 * 60_000
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

type BoxConnection = { apiKey: string; apiUrl?: string }

function connection(): BoxConnection {
  const box = config.box.instabox

  if (!box) throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

  return box
}

export function boxesEnabled(): boolean {
  return config.box.instabox !== null
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function requireBox(
  device: AgentDevice | null,
  deviceId: string,
): AgentDevice & { box: NonNullable<AgentDevice['box']> } {
  if (!device?.box) throw new AppError(404, 'not_found', `No Box ${deviceId}`)

  return device as AgentDevice & { box: NonNullable<AgentDevice['box']> }
}

/**
 * Orders the machine, registers its device row at once (state `creating`), and
 * installs and joins in the background; the row turns `running` when the host
 * joins, or `error` with the reason.
 */
export async function createBox(
  userId: string,
  teamId: string,
  label: string,
  backendUrl: string,
): Promise<AgentDevice> {
  const conn = connection()
  const deviceId = randomUUID()
  let sandbox: Sandbox

  try {
    sandbox = await Sandbox.create(BOX_TEMPLATE, {
      ...conn,
      name: `nuphos-${deviceId.slice(0, 8)}`,
      metadata: { teamId, deviceId, createdBy: userId },
      vault: false,
    })
  } catch (error) {
    logError('agent.box.create_failed', error, { user_id: userId })
    throw new AppError(503, 'box_unavailable', `Could not create the Box: ${message(error)}`)
  }
  const now = new Date()
  const registration = {
    deviceId,
    label,
    platform: 'linux',
    allowLocalExec: true,
    box: {
      provider: 'instabox' as const,
      sandboxId: sandbox.sandboxId,
      state: 'creating' as const,
      updatedAt: now,
    },
  }
  const device: AgentDevice = { ...registration, userId, createdAt: now, updatedAt: now }

  await insertBoxAgentDevice(userId, registration)
  const { token } = await issueDeviceJoinToken(userId, {
    label,
    deviceId,
    expiresInSec: JOIN_TOKEN_TTL_SEC,
  })

  void provision(sandbox, userId, deviceId, token, backendUrl)

  return device
}

async function provision(
  sandbox: Sandbox,
  userId: string,
  deviceId: string,
  token: string,
  backendUrl: string,
): Promise<void> {
  try {
    await sandbox.commands.run(BOX_INSTALL_COMMAND, { timeoutMs: INSTALL_TIMEOUT_MS })
    // The token rides in the environment of this one command: not on disk, not in argv.
    await sandbox.commands.run(AGENT_COMMAND, {
      envs: { NUPHOS_JOIN_TOKEN: token, NUPHOS_API_URL: backendUrl },
      timeoutMs: 60_000,
    })
    logEvent('info', 'agent.box.provisioned', { user_id: userId, device_id: deviceId })
  } catch (error) {
    logError('agent.box.provision_failed', error, { user_id: userId, device_id: deviceId })
    await setAgentDeviceBoxState(userId, deviceId, 'error', message(error).slice(0, 500))
  }
}

async function attach(sandboxId: string, resume: boolean): Promise<Sandbox> {
  try {
    return await Sandbox.connect(sandboxId, { ...connection(), resume })
  } catch (error) {
    throw new AppError(503, 'box_unavailable', `The Box did not answer: ${message(error)}`)
  }
}

export async function pauseBox(userId: string, deviceId: string): Promise<AgentDevice> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)

  if (device.box.state === 'creating')
    throw new AppError(409, 'box_state', 'The Box is still being created')
  const sandbox = await attach(device.box.sandboxId, false)

  try {
    await sandbox.pause()
  } catch (error) {
    throw new AppError(503, 'box_unavailable', `Could not pause the Box: ${message(error)}`)
  }
  await setAgentDeviceBoxState(userId, deviceId, 'paused')

  return requireBox(await getAgentDevice(userId, deviceId), deviceId)
}

/** Resumes the machine and makes sure the host runs; a stopped machine lost its processes. */
export async function resumeBox(
  userId: string,
  deviceId: string,
  backendUrl: string,
): Promise<AgentDevice> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)

  if (device.box.state === 'creating')
    throw new AppError(409, 'box_state', 'The Box is still being created')
  const sandbox = await attach(device.box.sandboxId, true)

  try {
    await sandbox.commands.run(AGENT_COMMAND, {
      envs: { NUPHOS_API_URL: backendUrl },
      timeoutMs: 60_000,
    })
  } catch (error) {
    throw new AppError(503, 'box_unavailable', `Could not start the agent: ${message(error)}`)
  }
  await setAgentDeviceBoxState(userId, deviceId, 'running')

  return requireBox(await getAgentDevice(userId, deviceId), deviceId)
}

/** Deletes the machine and its disks; the caller removes the device row. */
export async function destroyBox(userId: string, deviceId: string): Promise<void> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)

  try {
    await Sandbox.kill(device.box.sandboxId, connection())
  } catch (error) {
    logError('agent.box.kill_failed', error, { user_id: userId, device_id: deviceId })
    throw new AppError(503, 'box_unavailable', `Could not delete the Box: ${message(error)}`)
  }
}

/**
 * A paused Box selected for a turn or a command is resumed first, and this waits
 * for its tunnel. Anything else returns at once.
 */
export async function wakeBox(device: AgentDevice, backendUrl: string): Promise<boolean> {
  if (device.box?.state !== 'paused' && device.box?.state !== 'stopped') return false
  await resumeBox(device.userId, device.deviceId, backendUrl)
  const deadline = Date.now() + WAKE_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await isDevicePresent(device.userId, device.deviceId)) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  return false
}

export type { AgentDeviceBoxState }
