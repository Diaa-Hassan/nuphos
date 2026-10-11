// Hosts a runtime on a boat.dev sandbox instead of a pod. The sandbox runs the
// published image with a generated password and serves ACP on a public HTTPS
// route, so Nuphos registers it exactly like a self-hosted runtime and nothing
// here touches Kubernetes.

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

const API = 'https://boat.dev/api/v1'
const POLL_MS = 2_000
const POLL_ATTEMPTS = 30
const CALL_TIMEOUT_MS = 15_000
const WAKE_ATTEMPTS = 15
const PROBE_TIMEOUT_MS = 4_000

type Sandbox = { id: string; state: string; subdomain: string | null; error: string | null }

export type BoatDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  sleep: (ms: number) => Promise<void>
}

const defaults: BoatDeps = {
  // Resolved per call, so a test that replaces the global is honoured.
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export const boatApiKey = () => config.claudeCodeRuntimeProvisioner.boatApiKey

type CallOptions = {
  headers?: Record<string, string>
  body?: unknown
  /** Statuses that mean the sandbox is already where the call wants it. */
  allow?: number[]
}

async function call(deps: BoatDeps, method: string, path: string, options: CallOptions = {}) {
  const response = await deps.fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${boatApiKey() ?? ''}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })

  if (!response.ok && !options.allow?.includes(response.status))
    throw new AppError(
      503,
      'runtime_host_unavailable',
      'The agent host did not accept the request. Try again shortly.',
    )

  return response
}

// Containers and named volumes survive a sandbox stop and resume; `host` is
// idempotent, and the transport key is what guards the public route.
function setupScript(image: string): string {
  return [
    'set -eu',
    'docker run -d --name nuphos-runtime --restart unless-stopped -p 8080:8080 \\',
    '  -v nuphos-runtime-home:/home/node -v nuphos-runtime-workspace:/workspace \\',
    '  -e OPENAB_ACP_AUTH_KEY -e OPENAB_RUNTIME_CONSOLE=false \\',
    `  -e OPENAB_STREAM_EDIT_INTERVAL_MS=300 '${image}'`,
    'host 8080 --public',
  ].join('\n')
}

/** Creates the sandbox and returns once it has the subdomain its ACP address is built from. */
export async function createBoatRuntime(
  args: { runtimeId: string; image: string; authKey: string },
  deps: BoatDeps = defaults,
): Promise<{ sandboxId: string; url: string }> {
  const created = await call(deps, 'POST', '/sandboxes', {
    headers: { 'Idempotency-Key': args.runtimeId },
    body: {
      // A runtime is long-lived; nothing resumes one that auto-stopped.
      ttlSeconds: null,
      env: { OPENAB_ACP_AUTH_KEY: args.authKey },
      setupScript: setupScript(args.image),
    },
  })
  const read = async (response: Response) =>
    ((await response.json()) as { sandbox: Sandbox }).sandbox
  let sandbox = await read(created)
  const sandboxId = sandbox.id

  // Nothing else references the sandbox yet, so any failure from here removes it.
  try {
    for (let attempt = 0; !sandbox.subdomain && attempt < POLL_ATTEMPTS; attempt++) {
      if (sandbox.state === 'error' || sandbox.state === 'cancelled') break
      await deps.sleep(POLL_MS)
      sandbox = await read(await call(deps, 'GET', `/sandboxes/${sandboxId}`))
    }
    if (!sandbox.subdomain)
      throw new AppError(
        503,
        'runtime_host_unavailable',
        'The agent host did not become ready. Try again shortly.',
      )
  } catch (error) {
    await deleteBoatSandbox(sandboxId, deps).catch((cleanupError: unknown) => {
      logError('openab.boat.orphaned_sandbox', cleanupError, { sandbox_id: sandboxId })
    })
    throw error
  }

  return { sandboxId, url: `wss://${sandbox.subdomain}-8080.on.boat.dev/acp` }
}

/** Irreversible: removes the machine and its snapshots. An unknown sandbox is already gone. */
export async function deleteBoatSandbox(sandboxId: string, deps: BoatDeps = defaults) {
  await call(deps, 'DELETE', `/sandboxes/${sandboxId}`, {
    headers: { 'X-Ascii-Confirm-Delete': sandboxId },
    allow: [404],
  })
}

/** Accepted at once; boat snapshots the disk and archives the machine in the background. */
export async function stopBoatSandbox(sandboxId: string, deps: BoatDeps = defaults) {
  await call(deps, 'POST', `/sandboxes/${sandboxId}/stop`, { allow: [404] })
}

/**
 * Resumes a stopped sandbox and returns once the runtime answers on its route.
 * A sandbox that is still running refuses the resume with 409; the answer is
 * whether this call is the one that resumed it.
 */
export async function resumeBoatRuntime(
  sandboxId: string,
  runtimeUrl: string,
  deps: BoatDeps = defaults,
): Promise<boolean> {
  const resumed = await call(deps, 'POST', `/sandboxes/${sandboxId}/resume`, {
    body: { ttlSeconds: null },
    allow: [409],
  })
  const health = `https://${new URL(runtimeUrl).host}/health`

  for (let attempt = 0; attempt < WAKE_ATTEMPTS; attempt++) {
    const answer = await deps
      .fetch(health, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .catch(() => null)

    if (answer?.ok) return resumed.status !== 409
    await deps.sleep(POLL_MS)
  }
  throw new AppError(
    503,
    'runtime_waking',
    'The agent is still waking up. Send the message again in a moment.',
  )
}
