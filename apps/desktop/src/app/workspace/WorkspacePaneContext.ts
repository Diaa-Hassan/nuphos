import { createContext, useContext } from 'react'

import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'
import type { Dispatch, SetStateAction } from 'react'

export const WorkspacePaneContext = createContext<{
  sessionSearchOpen: boolean
  setSessionSearchOpen: Dispatch<SetStateAction<boolean>>
  focusSession: (sessionId: string, teamId?: string) => boolean
  openSessionBeside: (sessionId: string, teamId?: string) => boolean
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  isTabFocused: () => boolean
  closePane: () => void
  active: boolean
  primary: boolean
  sidebarHost: HTMLDivElement | null
  initialState?: WorkspaceState
  registerStore: (store: WorkspaceStore) => () => void
} | null>(null)

export function useWorkspacePane() {
  return useContext(WorkspacePaneContext)
}
