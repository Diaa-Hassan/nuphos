import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BOX_BADGE,
  anyCreating,
  boxActions,
  boxAgents,
  boxSetupPhase,
  boxState,
  boxes,
  newBoxBlockedReason,
} from './boxPresentation.ts'

import type { AgentDevice } from '../../api/device-types.ts'
import type { RuntimeInstance } from '../../types/runtime.ts'

const box = (
  deviceId: string,
  state: NonNullable<AgentDevice['box']>['state'],
  online = state === 'running',
) => ({
  deviceId,
  label: deviceId,
  platform: 'linux',
  online,
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

test('only a running Box pauses, only a paused one resumes, and a failed one can only be deleted', () => {
  assert.deepEqual(boxActions('running'), { pause: true, resume: false })
  assert.deepEqual(boxActions('paused'), { pause: false, resume: true })
  assert.deepEqual(boxActions('error'), { pause: false, resume: false })
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
  assert.equal(anyCreating([box('a', 'running', false)]), true)
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

test('a running machine whose agent is not connected yet still shows as creating', () => {
  assert.equal(boxState(box('a', 'running', false)), 'creating')
  assert.equal(boxState(box('a', 'running')), 'running')
  assert.equal(boxState(box('a', 'paused', false)), 'paused')
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

test('New Box is blocked without a plan and when the next Box would pass the cap', () => {
  const plan = { id: 'box-50', usd: 50, vcpus: 12 }
  const status = (current: typeof plan | null, usedVcpus: number) => ({
    enabled: true,
    plan: current,
    plans: [plan],
    usedVcpus,
    boxVcpus: 4,
  })

  assert.equal(newBoxBlockedReason(null), null)
  assert.equal(newBoxBlockedReason({ ...status(null, 0), enabled: false }), null)
  assert.match(newBoxBlockedReason(status(null, 0)) ?? '', /need a plan/)
  assert.equal(newBoxBlockedReason(status(plan, 8)), null)
  assert.match(newBoxBlockedReason(status(plan, 12)) ?? '', /12 of 12 vCPU/)
})
