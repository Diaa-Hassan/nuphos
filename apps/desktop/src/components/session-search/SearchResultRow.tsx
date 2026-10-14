import clsx from 'clsx'
import { CornerDownLeft, MessageSquare } from 'lucide-react'

import type { ReactNode } from 'react'

export function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1

  if (at < 0) return <>{text}</>

  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-[#6F5987]/35 text-[#E8DCF9]">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  )
}

export function SearchResultRow({
  id,
  title,
  subtitle,
  query,
  selected,
  avatar,
  onSelect,
  onOpen,
}: {
  id: string
  title: string
  subtitle: string
  query: string
  selected: boolean
  avatar?: ReactNode
  onSelect: () => void
  onOpen: (beside: boolean) => void
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onMouseMove={onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onOpen(event.metaKey || event.ctrlKey)}
      className={clsx(
        'flex min-h-[72px] cursor-pointer items-center gap-3.5 rounded-[7px] px-3 py-3',
        selected ? 'bg-[#38393C]' : 'hover:bg-[#303134]',
      )}
    >
      {avatar ?? <MessageSquare size={19} className="shrink-0 text-[#B7B8C2]" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-[#E6E7EC]">
          <Highlight text={title} query={query} />
        </div>
        <div className="mt-1.5 truncate text-xs text-[#B1B2BD]">{subtitle}</div>
      </div>
      {selected && (
        <span className="flex shrink-0 items-center gap-2 text-xs text-[#C4C5CF]">
          <span className="hidden sm:inline">{avatar ? 'View sessions' : 'Open'}</span>
          <CornerDownLeft size={15} />
        </span>
      )}
    </div>
  )
}
