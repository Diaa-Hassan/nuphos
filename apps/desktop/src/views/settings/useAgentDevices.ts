import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'

import { BOX_CREATING_POLL_MS } from './boxPresentation'

import type { AgentDeviceList } from '../../api'

const MAX_RETRY_MS = 30_000

/**
 * The signed-in user's devices. Loads on mount, on `reload` and when the window shows again;
 * polls again after the delay `poll` returns (0: not at all), never while the window is hidden, and backs off after
 * failures. A first load that fails (an older backend) is not retried. A new `key` starts over
 * from no list, so a caller never reads one taken before its change.
 */
export function useAgentDevices(poll: (list: AgentDeviceList) => number, key = '') {
  const [state, setState] = useState<{ key: string; list: AgentDeviceList } | null>(null)
  const [revision, setRevision] = useState(0)
  const pollRef = useRef(poll)

  // The latest predicate, read by the timer below without restarting it.
  useEffect(() => {
    pollRef.current = poll
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let last: AgentDeviceList | null = null
    let failures = 0
    const schedule = (ms: number) => {
      if (!document.hidden) timer = setTimeout(load, ms)
    }
    const load = () => {
      clearTimeout(timer)
      void api.boxListDevices().then(
        (next) => {
          if (cancelled) return
          last = next
          failures = 0
          setState({ key, list: next })
          const delay = pollRef.current(next)

          if (delay > 0) schedule(delay)
        },
        () => {
          if (cancelled || !last || pollRef.current(last) === 0) return
          failures += 1
          schedule(Math.min(BOX_CREATING_POLL_MS * 2 ** failures, MAX_RETRY_MS))
        },
      )
    }
    const onVisible = () => {
      if (!document.hidden) load()
    }

    load()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [revision, key])

  return {
    list: state?.key === key ? state.list : null,
    reload: useCallback(() => setRevision((value) => value + 1), []),
  }
}

/** Whether this backend can make Boxes; false until it says so. */
export function useBoxAvailable(): boolean {
  return useAgentDevices(() => 0).list?.boxAvailable === true
}
