import assert from 'node:assert/strict'
import test from 'node:test'

import { createSidebarSlot } from './sidebarSlot.ts'

const frames: (() => void)[] = []

globalThis.requestAnimationFrame = (callback) => {
  frames.push(() => callback(0))

  return frames.length
}
const nextFrame = () => frames.splice(0).forEach((run) => run())

test('the next pane takes over the sidebar without it being cleared in between', () => {
  const slot = createSidebarSlot()
  const shown: unknown[] = []

  slot.subscribe(() => shown.push(slot.current()))
  slot.show('pane A')
  // A closes; B shows its sidebar a commit later, before the next frame.
  slot.release()
  slot.show('pane B')
  nextFrame()
  assert.deepEqual(shown, ['pane A', 'pane B'])
  assert.equal(slot.current(), 'pane B')
})

test('a released sidebar nobody takes over is cleared on the next frame', () => {
  const slot = createSidebarSlot()

  slot.show('pane A')
  slot.release()
  assert.equal(slot.current(), 'pane A')
  nextFrame()
  assert.equal(slot.current(), null)
})

test('a pane that hands over the same sidebar again keeps it (an effect re-run)', () => {
  const slot = createSidebarSlot()
  const node = 'pane A'

  slot.show(node)
  slot.release()
  slot.show(node)
  nextFrame()
  assert.equal(slot.current(), 'pane A')
})
