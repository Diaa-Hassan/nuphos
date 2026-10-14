import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOX_BADGE, anyCreating, boxActions, boxAgents, boxes } from './boxPresentation.ts'

import type { AgentDevice } from '../../api/device-types.ts'
import type { RuntimeInstance } from '../../types/runtime.ts'

const box = (deviceId: string, state: NonNullable<AgentDevice['box']>['state']): AgentDevice => ({
  deviceId,
  label: deviceId,
  platform: 'linux',
  box: { provider: 'instabox', sandboxId: `sb-${deviceId}`, state },
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

test('only a running Box pauses, and a paused or failed one resumes', () => {
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
