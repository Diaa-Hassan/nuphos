import { useEffect, useId, useState } from 'react'

import { relativeTimeFromNow } from '../agent/panel/textUtils'
import { Avatar } from '../Avatar'

import { SearchResultRow } from './SearchResultRow'
import { useSearchResults } from './useSearchResults'

import type { TeamMember } from '../../types'
import type { RefObject } from 'react'

export function SearchResults({
  teamId,
  userId,
  teamName,
  mode,
  query,
  owner,
  inputRef,
  pending,
  onChoosePerson,
  onOpen,
}: {
  teamId: string
  userId: string
  teamName: string
  mode: 'sessions' | 'people'
  query: string
  owner: TeamMember | null
  inputRef: RefObject<HTMLInputElement | null>
  pending: boolean
  onChoosePerson: (person: TeamMember) => void
  onOpen: (sessionId: string, beside: boolean) => void
}) {
  const results = useSearchResults(teamId, userId, mode, query, owner?.id)
  const [selected, setSelected] = useState(0)
  const listId = useId()
  const count = mode === 'people' ? results.people.length : results.sessions.length
  const selectedIndex = Math.min(selected, Math.max(0, count - 1))
  const busy = pending || results.loading
  const activeId = !busy && count > 0 ? `${listId}-${selectedIndex}` : undefined

  useEffect(() => {
    const input = inputRef.current

    if (!input) return
    input.setAttribute('aria-controls', listId)
    if (activeId) input.setAttribute('aria-activedescendant', activeId)
    else input.removeAttribute('aria-activedescendant')
    document.getElementById(activeId ?? '')?.scrollIntoView({ block: 'nearest' })
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || busy || count === 0) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setSelected((previous) => (previous + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (mode === 'people') onChoosePerson(results.people[selectedIndex])
        else
          onOpen(
            results.sessions[selectedIndex].conversation.sessionId,
            event.metaKey || event.ctrlKey,
          )
      }
    }
    input.addEventListener('keydown', onKey)

    return () => {
      input.removeEventListener('keydown', onKey)
      input.removeAttribute('aria-activedescendant')
      input.removeAttribute('aria-controls')
    }
  }, [
    activeId,
    busy,
    count,
    inputRef,
    listId,
    mode,
    onChoosePerson,
    onOpen,
    results.people,
    results.sessions,
    selectedIndex,
  ])

  const heading =
    mode === 'people'
      ? `People in ${teamName}`
      : owner
        ? `Sessions by ${owner.name || owner.email}`
        : results.recent
          ? 'Recently opened'
          : 'Sessions'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="flex h-11 items-center justify-between gap-3 px-6 text-xs text-[#BFC0C9]">
        <span className="truncate font-medium">{heading}</span>
        {!busy && (
          <span className="shrink-0 text-[#AFAFB8]">
            {count}
            {results.hasMore ? '+' : ''}{' '}
            {mode === 'people'
              ? count === 1
                ? 'person'
                : 'people'
              : count === 1
                ? 'result'
                : 'results'}
          </span>
        )}
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={heading}
        aria-busy={busy}
        className="space-y-1 px-3 pb-3"
      >
        {!busy &&
          mode === 'people' &&
          results.people.map((person, index) => (
            <SearchResultRow
              key={person.id}
              id={`${listId}-${index}`}
              title={person.name || person.email}
              subtitle={person.email}
              query={query}
              selected={index === selectedIndex}
              avatar={
                <Avatar
                  src={person.avatarURL}
                  name={person.name || person.email}
                  size={32}
                  className="shrink-0 rounded-full"
                />
              }
              onSelect={() => setSelected(index)}
              onOpen={() => onChoosePerson(person)}
            />
          ))}
        {!busy &&
          mode === 'sessions' &&
          results.sessions.map(({ conversation, openedAt }, index) => (
            <SearchResultRow
              key={conversation.sessionId}
              id={`${listId}-${index}`}
              title={conversation.title || conversation.firstMessage || 'Untitled session'}
              subtitle={`${conversation.owner?.name || conversation.owner?.email || 'Unknown member'} · ${openedAt ? 'Opened' : 'Updated'} ${relativeTimeFromNow(openedAt ? new Date(openedAt).toISOString() : conversation.lastActiveAt)}`}
              query={query}
              selected={index === selectedIndex}
              onSelect={() => setSelected(index)}
              onOpen={(beside) => onOpen(conversation.sessionId, beside)}
            />
          ))}
      </div>
      <div role="status" className="px-6 text-sm text-[#B1B2BD]">
        {busy && <p className="py-8">Searching…</p>}
        {!busy && !results.error && count === 0 && (
          <p className="py-8">
            {results.recent
              ? 'Sessions you open will appear here. Type to search your team.'
              : mode === 'people'
                ? 'No people found. Try another name or email.'
                : 'No sessions found. Try another search or clear the person filter.'}
          </p>
        )}
        {!busy && results.error && (
          <p className="py-4">
            Some results could not be loaded.{' '}
            <button className="text-main underline" onClick={results.retry}>
              Retry
            </button>
          </p>
        )}
      </div>
      {!busy && results.hasMore && (
        <button
          className="mb-3 w-full py-2 text-xs text-[#C4C5CF] hover:text-white disabled:opacity-50"
          disabled={results.loadingMore}
          onClick={() => void results.loadMore()}
        >
          {results.loadingMore ? 'Loading…' : 'Load more sessions'}
        </button>
      )}
      {!busy && mode === 'people' && count > 0 && (
        <p className="px-6 pb-5 text-xs text-[#B2B3BD]">
          Choose a teammate, then search within their sessions.
        </p>
      )}
    </div>
  )
}
