import type { ReactNode } from 'react'

/**
 * The window's one sidebar. The active pane hands it the sidebar to show, so
 * clicking another pane updates the sidebar in place instead of unmounting one
 * pane's sidebar and mounting the other's (which reset its scroll, team header
 * and loading state on every pane switch). Only this slot re-renders on a hand-off.
 */
export type SidebarSlot = {
  show: (node: ReactNode) => void
  /**
   * The pane that showed the sidebar stopped. Kept until the next frame: the
   * pane taking over (after a close, say) may show its own a commit later, and
   * clearing first would rebuild the sidebar.
   */
  release: () => void
  subscribe: (listener: () => void) => () => void
  current: () => ReactNode
}

export function createSidebarSlot(): SidebarSlot {
  let node: ReactNode = null
  // Bumped by every show, so a pending release knows a pane has claimed the
  // slot since, even with the same node (an effect re-run hands over the same one).
  let claims = 0
  const listeners = new Set<() => void>()

  const set = (next: ReactNode) => {
    if (next === node) return
    node = next
    for (const listener of listeners) listener()
  }

  return {
    show: (next) => {
      claims += 1
      set(next)
    },
    release: () => {
      const claimed = claims

      requestAnimationFrame(() => {
        if (claims === claimed) set(null)
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    current: () => node,
  }
}
