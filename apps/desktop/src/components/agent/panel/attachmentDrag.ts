// Drags into a composer: files, attachments from another chat, page images.

/**
 * An attachment dragged out of a composer carries its local path under this
 * type, so another chat attaches the same file instead of the browser dropping
 * the thumbnail's `<img>` into the editor as rich content.
 */
export const ATTACHMENT_DRAG_TYPE = 'application/x-nuphos-attachment-paths'

export function setAttachmentDragData(dt: DataTransfer, paths: string[]) {
  dt.setData(ATTACHMENT_DRAG_TYPE, JSON.stringify(paths))
  dt.effectAllowed = 'copy'
}

/** The paths an attachment drag carries; empty for any other drag. */
export function attachmentDragPaths(dt: DataTransfer): string[] {
  try {
    const paths: unknown = JSON.parse(dt.getData(ATTACHMENT_DRAG_TYPE) || '[]')

    return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/**
 * A drag of a page image (a transcript picture, say) that is neither a file nor
 * an attachment. Dropped into the editor as-is, the browser inserts a raw
 * `<img>` the message can't send and the user can't remove.
 */
export function isRichImageDrop(dt: DataTransfer): boolean {
  return !dataTransferHasFiles(dt) && /<img\b/i.test(dt.getData('text/html'))
}

// True while a file/image drag (from Finder, or an attachment from another
// chat) is over a drop target. During dragover the data itself is unreadable —
// the only reliable signal is the types.
export function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  const types = new Set(Array.from(dt?.types ?? []))

  return types.has('Files') || types.has(ATTACHMENT_DRAG_TYPE)
}
