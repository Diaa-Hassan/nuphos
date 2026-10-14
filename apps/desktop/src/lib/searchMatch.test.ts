import assert from 'node:assert/strict'
import { test } from 'node:test'

import { searchMatch } from './searchMatch.ts'

test('search highlight preserves original offsets after length-changing Unicode case folds', () => {
  const text = 'İİİ deploy failed'
  const match = searchMatch(text, 'DEPLOY')!

  assert.equal(text.slice(match.start, match.end), 'deploy')
  assert.deepEqual(searchMatch('😀 部署完成', '部署'), { start: 3, end: 5 })
})

test('search treats regex metacharacters literally and handles absent queries', () => {
  assert.deepEqual(searchMatch('build [v3].*', '[v3].*'), { start: 6, end: 12 })
  assert.equal(searchMatch('anything', ''), null)
  assert.equal(searchMatch('anything', '.'), null)
})
