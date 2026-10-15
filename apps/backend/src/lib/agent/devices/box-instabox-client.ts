// The instabox connection shared by the Box provider: the deployment's key,
// bounded timeouts, and the commands a fresh machine runs.

import { DEFAULT_API_URL, InstaboxError, Sandbox } from '@insforge/instabox-sdk'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import type { Template } from '@insforge/instabox-sdk'

/** Installing the CLI and the agents on a fresh machine. */
export const INSTALL_TIMEOUT_MS = 9 * 60_000
/** Ordering a machine, in the background. */
export const CREATE_TIMEOUT_MS = 3 * 60_000
/** Anything on a turn's path: an instabox outage must not stall a conversation for long. */
export const QUICK_TIMEOUT_MS = 30_000

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

/**
 * Starts the host, which keeps the Box's own credential. Run with `background: true`:
 * a foreground run would wait for the host, which never exits on its own.
 */
export const AGENT_COMMAND =
  'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"; pgrep -f "[h]ost.mjs" >/dev/null || exec setsid nuphos agent >> "$HOME/nuphos-agent.log" 2>&1 < /dev/null'

export function connection(timeoutMs: number) {
  const box = config.box.instabox

  if (!box) throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

  return { ...box, requestTimeoutMs: timeoutMs, operationTimeoutMs: timeoutMs }
}

export function boxesEnabled(): boolean {
  return config.box.instabox !== null
}

/** Where a Box dials this backend from the internet: the deployment's public URL. */
export function boxBackendUrl(): string | undefined {
  const url = config.auth.publicBaseUrl

  return /^https?:\/\/localhost(?::\d+)?$/u.test(url) ? undefined : url
}

export function boxesAvailable(): boolean {
  return boxesEnabled() && boxBackendUrl() !== undefined
}

export const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
export const unavailable = (what: string, error: unknown) =>
  new AppError(503, 'box_unavailable', `${what}: ${reason(error)}`)

/** Deletes a machine, treating one that is already gone as deleted. */
export async function kill(sandboxId: string): Promise<void> {
  try {
    await Sandbox.kill(sandboxId, connection(QUICK_TIMEOUT_MS))
  } catch (error) {
    if (error instanceof InstaboxError && error.status === 404) return
    throw error
  }
}

/** The vCPUs a new machine of `template` gets: its default size, which the service fixes. */
export async function templateVcpus(template: string): Promise<number> {
  const { apiKey, apiUrl = DEFAULT_API_URL } = connection(QUICK_TIMEOUT_MS)
  const templates = await fetch(`${apiUrl}/v1/templates`, {
    headers: { 'X-API-Key': apiKey },
    signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
  }).then(
    async (response) =>
      response.ok ? ((await response.json()) as { templates: Template[] }).templates : [],
    () => [],
  )
  const vcpus = templates.find((t) => t.id === template)?.defaultSpec.vcpus

  if (!vcpus) throw unavailable('Could not read the Box size', `template ${template}`)

  return vcpus
}

/** The team's machines with their states and sizes, as instabox knows them. */
export async function teamMachines(teamId: string) {
  try {
    const machines = await Sandbox.list({ ...connection(QUICK_TIMEOUT_MS), metadata: { teamId } })

    return machines.map(({ sandboxId, state, machine }) => ({
      sandboxId,
      state,
      vcpus: machine.spec.vcpus,
    }))
  } catch (error) {
    throw unavailable("Could not read the team's Boxes", error)
  }
}
