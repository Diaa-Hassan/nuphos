import RFB from '@novnc/novnc'
import { Monitor } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { PageMeta } from '../app/pageMeta'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { IpcVncChannel } from '../lib/ipcVncChannel'

type Phase = 'connecting' | 'connected' | 'closed'

/**
 * A conversation's own desktop on its Box, watched over the Box's tunnel;
 * `filter` is the X display number. View-only until the owner takes it over:
 * the backend drops the viewer's input until then, and taking over also makes
 * the agent's input tools on that desktop wait.
 */
export function DesktopView({ teamId, filter }: { teamId: string; filter: string }) {
  const { conversationId, tabId } = useWorkspaceTab()
  const display = Number(filter)
  const host = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const channelRef = useRef<IpcVncChannel | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [holding, setHolding] = useState(false)

  useEffect(() => {
    const target = host.current

    if (!target || !conversationId || !tabId || !Number.isInteger(display)) return
    const channel = new IpcVncChannel(tabId).open({ teamId, sessionId: conversationId, display })
    const rfb = new RFB(target, channel as unknown as WebSocket, { shared: true })

    rfb.viewOnly = true
    rfb.scaleViewport = true
    rfb.background = 'transparent'
    rfb.addEventListener('connect', () => setPhase('connected'))
    rfb.addEventListener('disconnect', () => setPhase('closed'))
    rfbRef.current = rfb
    channelRef.current = channel
    setPhase('connecting')
    setHolding(false)

    return () => {
      rfb.disconnect()
      rfbRef.current = null
      channelRef.current = null
    }
  }, [conversationId, tabId, teamId, display])

  const toggle = () => {
    const next = !holding

    channelRef.current?.control(next ? 'human' : 'agent')
    if (rfbRef.current) rfbRef.current.viewOnly = !next
    setHolding(next)
  }
  const status = !conversationId
    ? 'Select a conversation to see its desktop.'
    : phase === 'connecting'
      ? 'Connecting to the desktop…'
      : phase === 'closed'
        ? 'The desktop has closed.'
        : holding
          ? 'You have the desktop; the agent’s input tools wait until you hand it back.'
          : 'Watching the agent’s desktop.'

  return (
    <PageMeta
      pageKey="team.desktop"
      title={`Desktop :${filter}`}
      icon={<Monitor className="h-3.5 w-3.5" />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-zGray-800 px-3 py-1.5 text-xs text-tertiary">
          <span className="min-w-0 flex-1 truncate">{status}</span>
          {phase === 'connected' && (
            <button
              type="button"
              onClick={toggle}
              className="rounded border border-zGray-700 px-2 py-0.5 text-main hover:bg-zGray-800"
            >
              {holding ? 'Hand back' : 'Take over'}
            </button>
          )}
        </div>
        <div ref={host} className="min-h-0 flex-1" />
      </div>
    </PageMeta>
  )
}
