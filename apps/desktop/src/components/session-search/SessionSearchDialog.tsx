import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { MessageSquare, Search, UserRound, Users, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { useSuspendTitlebarDrag } from '../../hooks/useSuspendTitlebarDrag'
import { useDebouncedValue } from '../agent/panel/historyPageHooks'
import { Kbd } from '../ui/kbd'

import { SearchResults } from './SearchResults'

import type { TeamMember } from '../../types'

type Props = {
  teamId: string
  teamName: string
  userId: string
  onClose: () => void
  onOpen: (sessionId: string, beside: boolean) => void
}

/** Unmounted on close/team change, so a workspace never inherits another search. */
export function SessionSearchDialog({ teamId, teamName, userId, onClose, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'sessions' | 'people'>('sessions')
  const [owner, setOwner] = useState<TeamMember | null>(null)
  const debouncedQuery = useDebouncedValue(query, 200)
  const inputRef = useRef<HTMLInputElement>(null)

  useSuspendTitlebarDrag(true)

  function choosePerson(person: TeamMember) {
    setOwner(person)
    setMode('sessions')
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50" />
        <Dialog.Viewport className="titlebar-no-drag fixed inset-0 z-[1001] flex items-start justify-center px-4 pt-[min(15vh,138px)] pb-6">
          <Dialog.Popup
            initialFocus={inputRef}
            className="flex max-h-full w-full max-w-[752px] flex-col overflow-hidden rounded-xl border border-[#45464A] bg-[#252628] text-[#E9E9ED] shadow-[0_18px_50px_#00000066] outline-none"
            onKeyDownCapture={(event) => {
              if (event.key === 'Escape' && mode === 'people' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.stopPropagation()
                setMode('sessions')
                setQuery('')
                inputRef.current?.focus()
              }
            }}
          >
            <Dialog.Title className="sr-only">Search sessions and people</Dialog.Title>
            <div className="flex h-[76px] shrink-0 items-center gap-3.5 border-b border-[#3C3D40] px-6">
              <Search size={22} className="shrink-0 text-[#C5C5CD]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={200}
                role="combobox"
                aria-expanded
                aria-autocomplete="list"
                aria-label={mode === 'people' ? 'Search people' : 'Search sessions'}
                placeholder={mode === 'people' ? 'Search people…' : 'Search sessions or people…'}
                className="min-w-0 flex-1 bg-transparent text-[22px] text-[#F3F3F6] outline-none placeholder:text-[#A5A6AF]"
              />
              <Dialog.Close
                aria-label="Close search"
                className="rounded focus-visible:outline focus-visible:outline-2"
              >
                <Kbd combo="esc" />
              </Dialog.Close>
            </div>
            <div className="flex h-[58px] shrink-0 items-center gap-1.5 border-b border-[#3C3D40] px-4">
              {(['sessions', 'people'] as const).map((value) => {
                const Icon = value === 'people' ? Users : MessageSquare

                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value)
                      inputRef.current?.focus()
                    }}
                    className={clsx(
                      'flex items-center gap-[7px] rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2',
                      mode === value
                        ? 'bg-[#3B3C3F] font-medium text-[#F4F4F7]'
                        : 'text-[#B0B1BC] hover:bg-[#303134]',
                    )}
                  >
                    <Icon size={15} />
                    {value === 'people' ? 'People' : 'Sessions'}
                  </button>
                )
              })}
              <span className="flex-1" />
              {owner && mode === 'sessions' ? (
                <button
                  aria-label={`Clear person filter: ${owner.name || owner.email}`}
                  onClick={() => {
                    setOwner(null)
                    inputRef.current?.focus()
                  }}
                  className="flex max-w-[45%] items-center gap-[7px] rounded-md bg-[#373239] px-2.5 py-[7px] text-xs text-[#E0D4E5]"
                >
                  <UserRound size={14} className="shrink-0" />
                  <span className="truncate">{owner.name || owner.email}</span>
                  <X size={12} className="shrink-0" />
                </button>
              ) : (
                <span className="truncate text-xs text-[#A7A8B2]">{teamName}</span>
              )}
            </div>
            <SearchResults
              key={JSON.stringify([teamId, mode, owner?.id, debouncedQuery])}
              teamId={teamId}
              teamName={teamName}
              userId={userId}
              mode={mode}
              query={debouncedQuery}
              owner={owner}
              inputRef={inputRef}
              pending={query.trim() !== debouncedQuery}
              onChoosePerson={choosePerson}
              onOpen={onOpen}
            />
            <div className="flex h-[50px] shrink-0 items-center gap-2 border-t border-[#3C3D40] px-6 text-[11px] text-[#ABADB8]">
              <span>Navigate</span>
              <Kbd combo="up" />
              <Kbd combo="down" />
              <span className="ml-2">Select</span>
              <Kbd combo="enter" />
              <span className="flex-1" />
              <span className="hidden sm:inline">
                {mode === 'people' ? 'Back to sessions' : 'Open beside'}
              </span>
              <Kbd combo={mode === 'people' ? 'esc' : 'mod+enter'} />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
