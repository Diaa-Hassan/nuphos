import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BOX_BADGE,
  anyCreating,
  boxActions,
  boxAgents,
  boxSetupPhase,
  boxSetupProblem,
  boxes,
  machines,
  vanishedBoxes,
} from './boxPresentation.ts'

import type { AgentDevice } from '../../api/device-types.ts'
import type { RuntimeInstance } from '../../types/runtime.ts'

const box = (
  deviceId: string,
  state: NonNullable<AgentDevice['box']>['state'],
  online = state === 'running',
  createdAt = new Date().toISOString(),
): AgentDevice => ({
  deviceId,
  label: deviceId,
  platform: 'linux',
  online,
  createdAt,
  box: { provider: 'instabox' as const, sandboxId: `sb-${deviceId}`, state },
})

test('each Box state has a badge', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(BOX_BADGE).map(([state, view]) => [state, view.label])),
    {
      creating: 'Creating',
      running: 'Running',
      paused: 'Paused',
      error: 'Error',
    },
  )
  assert.equal(BOX_BADGE.running.tone, 'online')
  assert.equal(BOX_BADGE.error.tone, 'error')
})

test('only a running Box pauses; a paused or unanswered one resumes', () => {
  assert.deepEqual(boxActions('running'), { pause: true, resume: false })
  assert.deepEqual(boxActions('paused'), { pause: false, resume: true })
  assert.deepEqual(boxActions('error'), { pause: false, resume: true })
  assert.deepEqual(boxActions('creating'), { pause: false, resume: false })
})

test('lists only Boxes and knows when one is being created', () => {
  const laptop: AgentDevice = { deviceId: 'mac', label: 'Mac', platform: 'darwin' }

  assert.deepEqual(
    boxes([laptop, box('a', 'running')]).map((device) => device.deviceId),
    ['a'],
  )
  assert.equal(anyCreating([laptop, box('a', 'running')]), false)
  assert.equal(anyCreating([box('a', 'running'), box('b', 'creating')]), true)
  assert.equal(anyCreating([box('a', 'running', false)]), false)
})

const agent = (id: string, kind: RuntimeInstance['kind'], deviceId?: string) =>
  ({ id, kind, ...(deviceId ? { local: { deviceId } } : {}) }) as RuntimeInstance

test("a Box's agents are the team's local agents on that device", () => {
  assert.deepEqual(
    boxAgents('a', [agent('1', 'local', 'a'), agent('2', 'local', 'b'), agent('3', 'managed')]).map(
      (instance) => instance.id,
    ),
    ['1'],
  )
})

test('a new Box is starting until the team lists one of its agents', () => {
  const claude = agent('1', 'local', 'a')

  assert.equal(boxSetupPhase(null, null, []), 'idle')
  assert.equal(boxSetupPhase('a', null, []), 'starting')
  assert.equal(boxSetupPhase('a', [box('a', 'creating')], []), 'starting')
  assert.equal(boxSetupPhase('a', [box('a', 'running')], []), 'starting')
  assert.equal(boxSetupPhase('a', [box('a', 'error')], []), 'error')
  assert.equal(boxSetupPhase('a', [box('a', 'running')], [claude]), 'ready')
})

test('a new Box fails when its row disappears or it is still creating after 5 minutes', () => {
  const now = Date.parse('2026-10-15T00:10:00Z')

  assert.equal(boxSetupPhase('a', [], [], now), 'error')
  assert.equal(
    boxSetupPhase('a', [box('a', 'creating', false, '2026-10-15T00:06:00Z')], [], now),
    'starting',
  )
  assert.equal(
    boxSetupPhase('a', [box('a', 'creating', false, '2026-10-15T00:04:00Z')], [], now),
    'timeout',
  )
  assert.equal(boxSetupProblem('starting'), null)
  assert.match(boxSetupProblem('timeout') ?? '', /5 minutes/)
})

test('a creating Box that drops out of the list is reported once', () => {
  assert.deepEqual(
    vanishedBoxes([box('a', 'creating'), box('b', 'running')], []).map((device) => device.deviceId),
    ['a'],
  )
  assert.deepEqual(vanishedBoxes([box('a', 'creating')], [box('a', 'running')]), [])
})

test('own computers show once per machine: the online or newest record wins', () => {
  const mac = (deviceId: string, createdAt: string, online = false): AgentDevice => ({
    deviceId,
    label: 'MacBook Pro',
    platform: 'darwin',
    online,
    createdAt,
  })
  const ids = (devices: AgentDevice[]) => machines(devices).map((device) => device.deviceId)

  assert.deepEqual(ids([mac('old', '2026-01-01'), mac('new', '2026-02-01')]), ['new'])
  assert.deepEqual(ids([mac('old', '2026-01-01', true), mac('new', '2026-02-01')]), ['old'])
  assert.deepEqual(
    ids([
      mac('m', '2026-01-01'),
      { ...mac('l', '2026-01-01'), platform: 'linux' },
      box('a', 'paused'),
      box('b', 'paused'),
    ]),
    ['m', 'l', 'a', 'b'],
  )
})
