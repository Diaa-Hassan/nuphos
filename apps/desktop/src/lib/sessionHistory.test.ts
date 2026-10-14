import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseSessionHistory,
  recordSessionVisit,
  readSessionHistory,
  sessionHistoryKey,
} from './sessionHistory.ts'

test('corrupt history is ignored and the preview batch is bounded', () => {
  assert.deepEqual(parseSessionHistory('{'), [])
  assert.deepEqual(parseSessionHistory('[null,{}, {"sessionId":"s","openedAt":"now"}]'), [])
  const entries = Array.from({ length: 20 }, (_, index) => ({
    sessionId: `s${index}`,
    openedAt: index,
  }))

  assert.equal(parseSessionHistory(JSON.stringify(entries)).length, 8)
})

test('visits are unique, newest first, and isolated by account and workspace', () => {
  const storage = new Map<string, string>()
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  try {
    recordSessionVisit('u1', 't1', 'a')
    recordSessionVisit('u1', 't1', 'b')
    recordSessionVisit('u1', 't1', 'a')
    assert.deepEqual(
      readSessionHistory('u1', 't1').map((entry) => entry.sessionId),
      ['a', 'b'],
    )
    assert.deepEqual(readSessionHistory('u2', 't1'), [])
    assert.deepEqual(readSessionHistory('u1', 't2'), [])
    assert.notEqual(sessionHistoryKey('a.b', 'c'), sessionHistoryKey('a', 'b.c'))
    assert.equal(storage.values().next().value?.includes('title'), false)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
