import { afterAll, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

const previousKey = config.claudeCodeRuntimeProvisioner.boatApiKey

config.claudeCodeRuntimeProvisioner.boatApiKey = 'boat_test'
afterAll(() => {
  config.claudeCodeRuntimeProvisioner.boatApiKey = previousKey
})

let store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })
const { boatRuntimeAsleep, stopIdleBoatRuntimes, wakeBoatRuntime } =
  await import('./runtime-boat-idle')

const NOW = new Date('2026-01-01T12:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
let calls: string[] = []
let activeTurn = false
let stopFails = false
let resumed = true
const deps = {
  resume: (sandboxId: string, url: string) => {
    calls.push(`resume ${sandboxId} ${url}`)

    return Promise.resolve(resumed)
  },
  stop: (sandboxId: string) => {
    calls.push(`stop ${sandboxId}`)

    return stopFails ? Promise.reject(new Error('refused')) : Promise.resolve()
  },
  hasActiveTurn: () => Promise.resolve(activeTurn),
}
const row = (fields: Record<string, unknown> = {}) => {
  const doc = {
    _id: 'runtime-1',
    teamId: 'one',
    url: 'wss://a-b-c-8080.on.boat.dev/acp',
    status: 'active',
    boatSandboxId: 'bx_23456789',
    boatUsedAt: minutesAgo(20),
    ...fields,
  }

  store.rows('claude_code_runtimes').push(doc)

  return doc as typeof doc & { boatStoppedAt?: Date }
}

beforeEach(() => {
  store = portabilityDb()
  calls = []
  activeTurn = false
  stopFails = false
  resumed = true
})

test('a runtime nobody has used for a while is stopped once', async () => {
  const idle = row()

  row({ _id: 'runtime-2', boatSandboxId: 'bx_recently', boatUsedAt: minutesAgo(5) })
  row({ _id: 'runtime-3', boatSandboxId: undefined })
  await stopIdleBoatRuntimes(deps, NOW)
  await stopIdleBoatRuntimes(deps, NOW)

  expect(calls).toEqual(['stop bx_23456789'])
  expect(idle.boatStoppedAt).toEqual(NOW)
})

test('a turn still running counts as use and keeps the sandbox up', async () => {
  const busy = row()

  activeTurn = true
  await stopIdleBoatRuntimes(deps, NOW)

  expect(calls).toEqual([])
  expect(busy).toMatchObject({ boatUsedAt: NOW })
  expect(busy.boatStoppedAt).toBeUndefined()
})

test('a stop the host refuses leaves the runtime marked as running', async () => {
  const idle = row()

  stopFails = true
  await stopIdleBoatRuntimes(deps, NOW)

  expect(calls).toEqual(['stop bx_23456789'])
  expect(idle.boatStoppedAt).toBeUndefined()
})

test('a turn on a stopped runtime resumes it first; on a running one it only records the use', async () => {
  const stopped = row({ boatStoppedAt: new Date() })

  expect(await boatRuntimeAsleep('one', 'runtime-1')).toBe(true)
  await wakeBoatRuntime('one', 'runtime-1', deps)
  expect(calls).toEqual(['resume bx_23456789 wss://a-b-c-8080.on.boat.dev/acp'])
  expect(stopped.boatStoppedAt).toBeUndefined()
  expect(stopped.boatUsedAt.getTime()).toBeGreaterThan(NOW.getTime())
  expect(await boatRuntimeAsleep('one', 'runtime-1')).toBe(false)

  await wakeBoatRuntime('one', 'runtime-1', deps)
  await wakeBoatRuntime('other-team', 'runtime-1', deps)
  await wakeBoatRuntime('one', undefined, deps)
  expect(calls).toHaveLength(1)
})

test('a wake that finds the sandbox still running leaves a fresh stop claim in place', async () => {
  const claimed = row({ boatStoppedAt: new Date() })

  resumed = false
  await wakeBoatRuntime('one', 'runtime-1', deps)

  expect(claimed.boatStoppedAt).toBeDefined()
})

test('a stop flag left behind on a running sandbox is cleared by the next turn', async () => {
  const leftover = row({ boatStoppedAt: minutesAgo(10) })

  resumed = false
  await wakeBoatRuntime('one', 'runtime-1', deps)

  expect(leftover.boatStoppedAt).toBeUndefined()
})
