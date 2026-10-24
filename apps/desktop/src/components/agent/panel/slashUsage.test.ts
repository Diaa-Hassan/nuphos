import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readAgentCommands,
  readSlashUsage,
  recordSlashUse,
  rememberAgentCommands,
  slashCommandsIn,
} from './slashUsage.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage
}

test('each sent command counts once per message', () => {
  const store = memoryStorage()

  recordSlashUse(['review', 'review', 'deploy'], store)
  assert.deepEqual(recordSlashUse(['review'], store), { review: 2, deploy: 1 })
  assert.deepEqual(readSlashUsage(store), { review: 2, deploy: 1 })
})

test('unreadable or odd stored usage reads as none', () => {
  assert.deepEqual(readSlashUsage(null), {})
  assert.deepEqual(readSlashUsage(memoryStorage({ 'nuphos.slashCommandUsage.v1': 'nope' })), {})
  assert.deepEqual(
    readSlashUsage(memoryStorage({ 'nuphos.slashCommandUsage.v1': '{"a":1,"b":"x"}' })),
    { a: 1 },
  )
})

test('a sent message uses the known commands written as /name', () => {
  const known = new Set(['review', 'deploy'])

  assert.deepEqual(slashCommandsIn('/review then /deploy', known), ['review', 'deploy'])
  assert.deepEqual(slashCommandsIn('see a/review and /usr/bin and /other', known), [])
})

test('a new conversation offers the commands its agent listed last', () => {
  const store = memoryStorage()
  const review = { name: 'review', description: 'Review the diff' }

  assert.deepEqual(readAgentCommands('rt-1', store), [])
  rememberAgentCommands('rt-1', [review], store)
  rememberAgentCommands('rt-2', [{ name: 'ship', description: '', hint: 'branch' }], store)
  assert.deepEqual(readAgentCommands('rt-1', store), [review])
  assert.deepEqual(readAgentCommands('rt-2', store), [
    { name: 'ship', description: '', hint: 'branch' },
  ])
  rememberAgentCommands('rt-1', [], store)
  assert.deepEqual(readAgentCommands('rt-1', store), [])
  assert.deepEqual(readAgentCommands(undefined, store), [])
})

test('unreadable or odd remembered commands read as none', () => {
  assert.deepEqual(readAgentCommands('rt-1', null), [])
  assert.deepEqual(
    readAgentCommands('rt-1', memoryStorage({ 'nuphos.agentCommands.v1': 'nope' })),
    [],
  )
  assert.deepEqual(
    readAgentCommands(
      'rt-1',
      memoryStorage({
        'nuphos.agentCommands.v1': '{"rt-1":[{"name":"ok","description":""},{"name":1}]}',
      }),
    ),
    [{ name: 'ok', description: '' }],
  )
})
