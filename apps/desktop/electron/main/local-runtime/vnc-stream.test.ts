import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { VncStream } from './vnc-stream.ts'

import type { AddressInfo, Socket } from 'node:net'

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

test('bridges base64 frames to the display’s VNC port and holds the lock while a human has the desktop', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'pool-'))

  mkdirSync(path.join(pool, '2.xdg'))
  const received: Buffer[] = []
  let client: Socket | undefined
  const server = createServer((socket) => {
    client = socket
    socket.on('data', (chunk) => received.push(chunk))
    socket.write('RFB 003.008\n')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const stream = new VncStream(pool, () => (server.address() as AddressInfo).port)
  const messages: string[] = []
  let closed = false

  stream.addEventListener('message', (event) => messages.push(String(event.data)))
  stream.addEventListener('close', () => {
    closed = true
  })
  await tick()
  assert.equal(stream.readyState, 1)
  stream.send(JSON.stringify({ t: 'open', display: 2, viewer: 'u 1' }))
  await tick()
  assert.deepEqual(messages, [Buffer.from('RFB 003.008\n').toString('base64')])
  stream.send(Buffer.from('hello').toString('base64'))
  await tick()
  assert.equal(Buffer.concat(received).toString(), 'hello')
  const control = path.join(pool, '2.xdg', 'instabox-control')

  stream.send(JSON.stringify({ t: 'control', owner: 'human' }))
  assert.match(readFileSync(control, 'utf8'), /^human u1 \d+\n$/u)
  stream.send(JSON.stringify({ t: 'control', owner: 'agent' }))
  assert.equal(readFileSync(control, 'utf8'), 'agent\n')
  stream.send(JSON.stringify({ t: 'control', owner: 'human' }))
  stream.close()
  assert.equal(readFileSync(control, 'utf8'), 'agent\n')
  assert.equal(closed, true)
  await tick()
  assert.equal(client?.destroyed, true)
  server.close()
})

test('an unknown frame before the display is named ends the stream', async () => {
  const stream = new VncStream('/nonexistent')
  let closed = false

  stream.addEventListener('close', () => {
    closed = true
  })
  await tick()
  stream.send('{"t":"control","owner":"human"}')
  assert.equal(closed, true)
})
