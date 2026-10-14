import assert from 'node:assert/strict'
import { test } from 'node:test'

import { searchKeyAction } from './searchKeyboard.ts'

const enter = {
  key: 'Enter',
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}

test('IME confirmation, pending queries and empty results never open a session', () => {
  assert.equal(searchKeyAction({ ...enter, isComposing: true }, false, 2, true), null)
  assert.equal(searchKeyAction(enter, true, 2, true), null)
  assert.equal(searchKeyAction(enter, false, 0, true), null)
  assert.equal(
    searchKeyAction({ ...enter, key: 'ArrowDown', isComposing: true }, false, 2, true),
    null,
  )
})
test('search follows platform link modifiers and supports arrow navigation', () => {
  assert.equal(searchKeyAction(enter, false, 2, true), 'open')
  assert.equal(searchKeyAction({ ...enter, metaKey: true }, false, 2, true), 'beside')
  assert.equal(searchKeyAction({ ...enter, ctrlKey: true }, false, 2, true), null)
  assert.equal(searchKeyAction({ ...enter, ctrlKey: true }, false, 2, false), 'beside')
  assert.equal(searchKeyAction({ ...enter, metaKey: true, shiftKey: true }, false, 2, true), null)
  assert.equal(searchKeyAction({ ...enter, key: 'ArrowDown' }, false, 2, true), 'next')
  assert.equal(searchKeyAction({ ...enter, key: 'ArrowUp' }, false, 2, true), 'previous')
})
