import { linkClickMode } from './linkClickMode.ts'

/** Leave composing, loading, and unsupported modified keys to the input. */
export function searchKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  busy: boolean,
  count: number,
  mac: boolean,
) {
  if (event.isComposing || busy || count === 0) return null
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  if (event.key !== 'Enter') return null

  return linkClickMode(
    {
      button: 0,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    },
    mac,
  )
}
