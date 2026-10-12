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

// The sandbox is the isolation boundary, so the image is only how the runtime
// gets there: its filesystem is unpacked once and the runtime runs from it as a
// service, which a resume starts without waiting for a container engine. The
// transport key comes from the sandbox environment and guards the public route.
export function setupScript(image: string): string {
  return `set -eu
image='${image}'
docker pull -q "$image"
container=$(docker create "$image")
sudo mkdir -p /opt/nuphos-runtime
docker export "$container" | sudo tar -x -C /opt/nuphos-runtime
{
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image"
  echo "OPENAB_ACP_AUTH_KEY=$OPENAB_ACP_AUTH_KEY"
  echo OPENAB_RUNTIME_CONSOLE=false
  echo OPENAB_STREAM_EDIT_INTERVAL_MS=300
} | sudo install -m 600 /dev/stdin /etc/nuphos-runtime.env
docker rm "$container" >/dev/null
docker image rm "$image" >/dev/null
sudo tee /etc/systemd/system/nuphos-runtime.service >/dev/null <<'UNIT'
[Unit]
Description=Nuphos runtime
After=network-online.target
Wants=network-online.target

[Service]
RootDirectory=/opt/nuphos-runtime
MountAPIVFS=yes
BindReadOnlyPaths=/run/systemd/resolve/stub-resolv.conf:/etc/resolv.conf
User=1000
Group=1000
WorkingDirectory=/home/node
EnvironmentFile=/etc/nuphos-runtime.env
ExecStart=/usr/local/bin/nuphos-runtime-start openab run -c /etc/openab/config.toml
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now nuphos-runtime
host 8080 --public
`
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

/**
 * Accepted at once; boat archives the machine within a few seconds. A sandbox
 * that is already archived answers 400, which is where the call wants it.
 */
export async function stopBoatSandbox(sandboxId: string, deps: BoatDeps = defaults) {
  await call(deps, 'POST', `/sandboxes/${sandboxId}/stop`, { allow: [400, 404] })
}

/**
 * Resumes a stopped sandbox and returns once the runtime answers on its route.
 * Resuming one that is running, or still being stopped, is accepted too: it
 * cancels the stop and the sandbox stays up.
 */
export async function resumeBoatRuntime(
  sandboxId: string,
  runtimeUrl: string,
  deps: BoatDeps = defaults,
): Promise<void> {
  await call(deps, 'POST', `/sandboxes/${sandboxId}/resume`, { body: { ttlSeconds: null } })
  const health = `https://${new URL(runtimeUrl).host}/health`

  for (let attempt = 0; attempt < WAKE_ATTEMPTS; attempt++) {
    const answer = await deps
      // A stopped sandbox's route redirects to a boat page that answers 200.
      .fetch(health, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .catch(() => null)

    if (answer?.ok) return
    await deps.sleep(POLL_MS)
  }
  throw new AppError(
    503,
    'runtime_waking',
    'The agent is still waking up. Send the message again in a moment.',
  )
}
