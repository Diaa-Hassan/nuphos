import { afterAll, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import {
  createBoatRuntime,
  deleteBoatSandbox,
  resumeBoatRuntime,
  stopBoatSandbox,
} from './runtime-boat'

const previousKey = config.claudeCodeRuntimeProvisioner.boatApiKey

config.claudeCodeRuntimeProvisioner.boatApiKey = 'boat_test'
afterAll(() => {
  config.claudeCodeRuntimeProvisioner.boatApiKey = previousKey
})

type Call = { method: string; path: string; headers: Record<string, string>; body?: unknown }
let calls: Call[] = []
let replies: { status: number; body?: unknown }[] = []
let redirects: (string | undefined)[] = []

const deps = {
  fetch: ((url: string, init: RequestInit) => {
    redirects.push(init.redirect)
    calls.push({
      method: init.method ?? 'GET',
      path: url.replace('https://boat.dev/api/v1', ''),
      headers: (init.headers ?? {}) as Record<string, string>,
      ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    })
    const reply = replies.shift() ?? { status: 500 }

    return Promise.resolve(Response.json(reply.body ?? {}, { status: reply.status }))
  }) as unknown as typeof fetch,
  sleep: () => Promise.resolve(),
}
const sandbox = (subdomain: string | null, state = 'provisioning') => ({
  sandbox: { id: 'bx_23456789', state, subdomain, error: null },
})
const args = {
  runtimeId: 'runtime-1',
  image: 'ghcr.io/nuphos/runtime:1.2.3-codex',
  authKey: 'transport-key-0123456789',
}

beforeEach(() => {
  calls = []
  replies = []
  redirects = []
})

test('creates an always-on sandbox that runs the image and waits for its address', async () => {
  replies = [
    { status: 202, body: sandbox(null) },
    { status: 200, body: sandbox(null) },
    { status: 200, body: sandbox('frazil-pneuma-rallye', 'ready') },
  ]

  expect(await createBoatRuntime(args, deps)).toEqual({
    sandboxId: 'bx_23456789',
    url: 'wss://frazil-pneuma-rallye-8080.on.boat.dev/acp',
  })
  const [create, ...polls] = calls

  expect(create).toMatchObject({
    method: 'POST',
    path: '/sandboxes',
    headers: { Authorization: 'Bearer boat_test', 'Idempotency-Key': 'runtime-1' },
    body: { ttlSeconds: null, env: { OPENAB_ACP_AUTH_KEY: args.authKey } },
  })
  const { setupScript } = create!.body as { setupScript: string }

  // The key reaches the runtime from the sandbox environment, never the script.
  expect(setupScript).toContain(`image='${args.image}'`)
  expect(setupScript).toContain('systemctl enable --now nuphos-runtime')
  expect(setupScript).toContain('host 8080 --public')
  expect(setupScript).not.toContain(args.authKey)
  expect(polls.map((call) => [call.method, call.path])).toEqual([
    ['GET', '/sandboxes/bx_23456789'],
    ['GET', '/sandboxes/bx_23456789'],
  ])
})

test('a sandbox that never gets an address is deleted rather than left running', async () => {
  replies = [
    { status: 202, body: sandbox(null) },
    { status: 200, body: sandbox(null, 'error') },
    { status: 202 },
  ]

  await expect(createBoatRuntime(args, deps)).rejects.toMatchObject({
    code: 'runtime_host_unavailable',
  })
  expect(calls.at(-1)).toMatchObject({
    method: 'DELETE',
    path: '/sandboxes/bx_23456789',
    headers: { 'X-Ascii-Confirm-Delete': 'bx_23456789' },
  })
})

test('a poll the host refuses deletes the sandbox instead of orphaning it', async () => {
  replies = [{ status: 202, body: sandbox(null) }, { status: 500 }, { status: 202 }]

  await expect(createBoatRuntime(args, deps)).rejects.toMatchObject({
    code: 'runtime_host_unavailable',
  })
  expect(calls.map((call) => call.method)).toEqual(['POST', 'GET', 'DELETE'])
})

test('a create the host answers with 404 is refused, not read as a sandbox', async () => {
  replies = [{ status: 404 }]

  await expect(createBoatRuntime(args, deps)).rejects.toMatchObject({
    code: 'runtime_host_unavailable',
  })
})

test('deleting an unknown sandbox succeeds; any other refusal is surfaced', async () => {
  replies = [{ status: 404 }, { status: 409 }]

  await deleteBoatSandbox('bx_23456789', deps)
  await expect(deleteBoatSandbox('bx_23456789', deps)).rejects.toBeInstanceOf(AppError)
})

test('resume keeps the sandbox always-on and waits until the runtime answers', async () => {
  // A stopped sandbox's route redirects (302) before the runtime is back.
  replies = [{ status: 202 }, { status: 302 }, { status: 502 }, { status: 200 }]

  await resumeBoatRuntime('bx_23456789', 'wss://a-b-c-8080.on.boat.dev/acp', deps)
  expect(calls[0]).toMatchObject({
    method: 'POST',
    path: '/sandboxes/bx_23456789/resume',
    body: { ttlSeconds: null },
  })
  expect(calls.slice(1).map((call) => call.path)).toEqual([
    'https://a-b-c-8080.on.boat.dev/health',
    'https://a-b-c-8080.on.boat.dev/health',
    'https://a-b-c-8080.on.boat.dev/health',
  ])
  expect(redirects).toEqual([undefined, 'manual', 'manual', 'manual'])
})

test('a runtime that never answers after a resume asks the sender to retry', async () => {
  replies = [{ status: 202 }]

  await expect(
    resumeBoatRuntime('bx_23456789', 'wss://a-b-c-8080.on.boat.dev/acp', deps),
  ).rejects.toMatchObject({ code: 'runtime_waking' })
})

test('stop posts to the sandbox, and one that is already archived is not an error', async () => {
  replies = [{ status: 202 }, { status: 400 }]

  await stopBoatSandbox('bx_23456789', deps)
  await stopBoatSandbox('bx_23456789', deps)
  expect(calls[0]).toMatchObject({ method: 'POST', path: '/sandboxes/bx_23456789/stop' })
})
