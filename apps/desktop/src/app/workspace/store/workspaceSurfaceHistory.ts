import { navigationKey, pushNavigation } from '../../../lib/navHistory.ts'
import { restoreNavigation } from '../../workspaceTabFactory.ts'

import { MAIN_PAGE_BUCKET_KEY, selectBucket, surfaceOf } from './workspaceState.ts'

import type { TabHistoryMode } from './workspaceActions'
import type { SurfaceEntry, WorkspaceState, WorkspaceSurface } from './workspaceState'
import type { NavigationSnapshot } from '../../../lib/appRoutes'

const SURFACE_HISTORY_LIMIT = 50

function sameSurfacePlace(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  return a.sessionId === b.sessionId && a.mainPageOpen === b.mainPageOpen
}

function samePage(a: SurfaceEntry, b: SurfaceEntry): boolean {
  return (a.page ? navigationKey(a.page) : null) === (b.page ? navigationKey(b.page) : null)
}

/** The page the main pane's tab is on, while the main page is what the pane shows. */
function mainPageSnapshot(state: WorkspaceState): NavigationSnapshot | undefined {
  if (!state.mainPageOpen) return undefined
  const bucket = selectBucket(state, MAIN_PAGE_BUCKET_KEY)
  const tab = bucket.tabs.find((candidate) => candidate.id === bucket.activeTabId)

  return tab?.navHistory[tab.navHistoryIndex]
}

function entryOf(state: WorkspaceState): SurfaceEntry {
  const page = mainPageSnapshot(state)

  return page
    ? { ...surfaceOf(state), page, at: Date.now() }
    : { ...surfaceOf(state), at: Date.now() }
}

/**
 * One timeline of everything the main pane showed, in the order the user saw
 * it, like a browser's: chats, and each page of the main page (Inbox, Agents,
 * …). Whichever action made the change, it is undone the same way.
 *
 * A change of read-only or team in the same place rewrites its entry, and so
 * does a page `replace` (typing in a search box) or `restore`; like a browser's
 * replaceState, that keeps the entries Forward would return to. Leaving a blank
 * New chat rewrites it too: there is nothing on it to come back to, so Back
 * from a chat started there returns to where the user was before.
 */
export function recordSurface(next: WorkspaceState, pageHistory?: TabHistoryMode): WorkspaceState {
  const current =
    next.surfaceHistoryIndex >= 0 ? next.surfaceHistory.at(next.surfaceHistoryIndex) : undefined
  const to = entryOf(next)

  if (
    current &&
    sameSurfacePlace(current, to) &&
    current.sessionReadOnly === to.sessionReadOnly &&
    current.teamScope?.teamId === to.teamScope?.teamId &&
    current.page === to.page
  ) {
    return next
  }
  const blankChat = current?.sessionId === null && !current.mainPageOpen && !to.mainPageOpen
  const pageMove =
    current !== undefined &&
    sameSurfacePlace(current, to) &&
    to.mainPageOpen &&
    !samePage(current, to) &&
    pageHistory !== 'replace' &&
    pageHistory !== 'restore'
  const moved = !current || (!sameSurfacePlace(current, to) && !blankChat) || pageMove
  // A rewrite keeps the entry's time: it marks when the user arrived there.
  const kept = current && !moved ? { ...to, at: current.at } : to

  // An update in the same place is not a navigation: rewrite that entry and keep Forward.
  if (current && !moved && sameSurfacePlace(current, to)) {
    const surfaceHistory = next.surfaceHistory.map((entry, index) =>
      index === next.surfaceHistoryIndex ? kept : entry,
    )

    return { ...next, surfaceHistory }
  }
  // Anything else goes somewhere new, so the entries ahead of the cursor go.
  const behind = next.surfaceHistory.slice(0, next.surfaceHistoryIndex + 1)
  const surfaceHistory = (moved ? [...behind, kept] : [...behind.slice(0, -1), kept]).slice(
    -SURFACE_HISTORY_LIMIT,
  )

  return { ...next, surfaceHistory, surfaceHistoryIndex: surfaceHistory.length - 1 }
}

/**
 * Drop history entries Back must not return to — a chat that could not be
 * shown, a team the account left — keeping the cursor on the entry it was on,
 * or the one before it when that entry itself is dropped.
 */
export function retainSurfaces(
  state: WorkspaceState,
  keep: (surface: WorkspaceSurface) => boolean,
): WorkspaceState {
  const surfaceHistory: SurfaceEntry[] = []
  let surfaceHistoryIndex = -1

  state.surfaceHistory.forEach((surface, index) => {
    const last = surfaceHistory.at(-1)

    if (keep(surface) && !(last && sameSurfacePlace(last, surface) && samePage(last, surface))) {
      surfaceHistory.push(surface)
    }
    if (index === state.surfaceHistoryIndex) surfaceHistoryIndex = surfaceHistory.length - 1
  })
  if (surfaceHistory.length === state.surfaceHistory.length) return state

  return { ...state, surfaceHistory, surfaceHistoryIndex }
}

/** A chat the pane could not show: leave it, and drop it from Back/Forward. */
export function forgetSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  const left =
    state.sessionId === sessionId ? { ...state, sessionId: null, sessionReadOnly: false } : state

  return retainSurfaces(left, (surface) => surface.sessionId !== sessionId)
}

/** Back/Forward, or a pick from the history menu: show the entry at `index`. */
export function goToSurface(state: WorkspaceState, index: number): WorkspaceState {
  const entry = index >= 0 ? state.surfaceHistory.at(index) : undefined

  if (!entry || index === state.surfaceHistoryIndex) return state
  const { page, at: _at, ...surface } = entry
  const next = { ...state, ...surface, surfaceHistoryIndex: index }

  if (!page) return next
  const bucket = selectBucket(next, MAIN_PAGE_BUCKET_KEY)
  // The tab's own stack follows, so the page it reports matches the entry.
  const tabs = bucket.tabs.map((tab) => {
    if (tab.id !== bucket.activeTabId) return tab
    const nav = pushNavigation(tab, page)

    return { ...restoreNavigation(tab, page, nav.navHistoryIndex), navHistory: nav.navHistory }
  })

  return { ...next, buckets: { ...next.buckets, [MAIN_PAGE_BUCKET_KEY]: { ...bucket, tabs } } }
}

export function stepSurface(state: WorkspaceState, direction: -1 | 1): WorkspaceState {
  return goToSurface(state, state.surfaceHistoryIndex + direction)
}
