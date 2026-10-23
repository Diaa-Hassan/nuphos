import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ATTACHMENT_DRAG_TYPE,
  attachmentDragPaths,
  dataTransferHasFiles,
  isRichImageDrop,
  setAttachmentDragData,
} from './attachmentDrag.ts'

/** The parts of a DataTransfer the drag helpers use. */
function fakeTransfer(data: Record<string, string> = {}, files = false) {
  const store = new Map(Object.entries(data))

  return {
    get types() {
      return [...(files ? ['Files'] : []), ...store.keys()]
    },
    effectAllowed: 'all',
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => void store.set(type, value),
  } as unknown as DataTransfer
}

test('an attachment dragged out of a chat carries its path to the chat it lands on', () => {
  const dt = fakeTransfer()

  setAttachmentDragData(dt, ['/Users/alex/Desktop/shot.png'])
  assert.equal(dt.effectAllowed, 'copy')
  assert.equal(dataTransferHasFiles(dt), true)
  assert.deepEqual(attachmentDragPaths(dt), ['/Users/alex/Desktop/shot.png'])
})

test('other drags carry no attachment paths', () => {
  assert.deepEqual(attachmentDragPaths(fakeTransfer({ 'text/plain': 'hi' })), [])
  assert.deepEqual(attachmentDragPaths(fakeTransfer({ [ATTACHMENT_DRAG_TYPE]: 'not json' })), [])
  assert.deepEqual(attachmentDragPaths(fakeTransfer({ [ATTACHMENT_DRAG_TYPE]: '[1,"/a.png"]' })), [
    '/a.png',
  ])
})

test('a page image dropped into the editor is blocked; text and files are not', () => {
  const html = '<img src="blob:x">'

  assert.equal(isRichImageDrop(fakeTransfer({ 'text/html': html })), true)
  assert.equal(
    isRichImageDrop(fakeTransfer({ 'text/html': '<b>hi</b>', 'text/plain': 'hi' })),
    false,
  )
  assert.equal(isRichImageDrop(fakeTransfer({ 'text/html': html }, true)), false)
  assert.equal(
    isRichImageDrop(fakeTransfer({ 'text/html': html, [ATTACHMENT_DRAG_TYPE]: '[]' })),
    false,
  )
})
