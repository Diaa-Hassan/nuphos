import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: unknown[][] = []

mock.module('../atlas/client.ts', {
  namedExports: {
    call: (...args: unknown[]) => {
      calls.push(args)

      return Promise.resolve({})
    },
  },
})
const { boxChannels } = await import('./channels-box.ts')

test('Box IPC channels call the personal device routes', async () => {
  await boxChannels['box:listDevices']()
  await boxChannels['box:create'](null, 'demo')
  await boxChannels['box:create'](null)
  await boxChannels['box:pause'](null, 'dev/1')
  await boxChannels['box:resume'](null, 'dev/1')
  await boxChannels['box:delete'](null, 'dev/1')

  assert.deepEqual(
    calls.map(([method, route, body]) => [method, route, body]),
    [
      ['GET', '/agent/devices', undefined],
      ['POST', '/agent/devices/boxes', { label: 'demo' }],
      ['POST', '/agent/devices/boxes', {}],
      ['POST', '/agent/devices/dev%2F1/box/pause', undefined],
      ['POST', '/agent/devices/dev%2F1/box/resume', undefined],
      ['DELETE', '/agent/devices/dev%2F1/box', undefined],
    ],
  )
})
