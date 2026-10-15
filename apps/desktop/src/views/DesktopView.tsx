import { Monitor } from 'lucide-react'

import { PageMeta } from '../app/pageMeta'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

/** A conversation's own desktop on its Box; `filter` is the X display number. */
export function DesktopView({ filter }: { filter: string }) {
  const { conversationId } = useWorkspaceTab()

  return (
    <PageMeta
      pageKey="team.desktop"
      title={`Desktop :${filter}`}
      icon={<Monitor className="h-3.5 w-3.5" />}
    >
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-xs text-tertiary">
          {conversationId
            ? `This conversation's desktop on display :${filter}.`
            : 'Select a conversation to see its desktop.'}
        </p>
      </div>
    </PageMeta>
  )
}
