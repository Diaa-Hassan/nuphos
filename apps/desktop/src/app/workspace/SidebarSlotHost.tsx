import { useLayoutEffect, useSyncExternalStore } from 'react'

import { ChatLinkMenuContext } from '../../components/agent/chatLinkMenuContext'

import { WorkspacePaneContext } from './WorkspacePaneContext'
import { WorkspaceSidebarPanel } from './WorkspaceSidebarPanel'

import type { SidebarSlot } from './sidebarSlot'
import type { WorkspaceController } from './useWorkspaceController'
import type { WorkspacePaneValue } from './WorkspacePaneContext'
import type { UserInfo } from '../../types'

/** Renders whatever sidebar the active pane handed over; only this re-renders on a hand-off. */
export function SidebarSlotHost({ slot }: { slot: SidebarSlot }) {
  return <>{useSyncExternalStore(slot.subscribe, slot.current, slot.current)}</>
}

/**
 * Hands this pane's sidebar to the window's one sidebar while the pane is
 * active, with the contexts it had when it was portaled from here.
 */
export function ActivePaneSidebar({
  pane,
  ws,
  user,
}: {
  pane: WorkspacePaneValue
  ws: WorkspaceController
  user: UserInfo
}) {
  const node = (
    <WorkspacePaneContext.Provider value={pane}>
      <ChatLinkMenuContext.Provider value={ws.chatLinkMenuActions}>
        <WorkspaceSidebarPanel ws={ws} user={user} />
      </ChatLinkMenuContext.Provider>
    </WorkspacePaneContext.Provider>
  )

  useLayoutEffect(() => {
    pane.sidebar.show(node)
  })
  useLayoutEffect(() => () => pane.sidebar.release(), [pane.sidebar])

  return null
}
