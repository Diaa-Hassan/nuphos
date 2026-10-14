import clsx from 'clsx'
import { Box, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { AGENT_PROVIDER } from '../../types/runtime'

import { BOX_BADGE, boxActions, boxAgents, boxPollMs, boxes } from './boxPresentation'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { STATUS_DOT } from './runtimePresentation'
import { inputClasses } from './styles'

import type { AgentDeviceList } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'

type BoxDevice = ReturnType<typeof boxes>[number]

/** The signed-in user's own Boxes, above the team's agents. Hidden when the backend has no Box provider. */
export function BoxSection({
  teamId,
  instances,
}: {
  teamId: string
  instances: RuntimeInstance[]
}) {
  const [list, setList] = useState<AgentDeviceList | null>(null)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [revision, setRevision] = useState(0)

  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = () =>
      void api.boxListDevices().then(
        (next) => {
          if (cancelled) return
          setList(next)
          timer = setTimeout(poll, boxPollMs(next.devices))
        },
        () => {
          if (!cancelled) timer = setTimeout(poll, boxPollMs([]))
        },
      )

    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [revision])

  if (!list?.boxAvailable) return null

  const create = async () => {
    setCreating(true)
    try {
      await api.boxCreate(label.trim() || undefined)
      setLabel('')
      reload()
    } catch (error) {
      toast.apiError('Could not create Box', error)
    } finally {
      setCreating(false)
    }
  }
  const owned = boxes(list.devices)

  return (
    <section aria-label="Boxes" className="mx-auto w-full max-w-5xl px-5 pt-5 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-main">Boxes</h2>
          <p className="mt-0.5 text-[12px] text-tertiary">
            Linux computers Nuphos runs for you, with their own agents and local exec. Only you can
            use them.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <input
            type="text"
            maxLength={200}
            value={label}
            placeholder="Name (optional)"
            aria-label="Box name"
            onChange={(event) => setLabel(event.target.value)}
            className={clsx(inputClasses, 'h-8 w-44')}
          />
          <Button type="submit" size="sm" disabled={creating}>
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Box className="h-3.5 w-3.5" />
            )}
            New Box
          </Button>
        </form>
      </div>
      {owned.length > 0 && (
        <ul className="mt-3 divide-y divide-zGray-800/60 rounded-xl border border-zGray-800/70">
          {owned.map((device) => (
            <BoxRow
              key={device.deviceId}
              teamId={teamId}
              device={device}
              agents={boxAgents(device.deviceId, instances)}
              onChanged={reload}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function boxDetail(state: BoxDevice['box']['state'], agents: RuntimeInstance[], platform: string) {
  if (state === 'creating') return 'Starting the computer, usually 10–30 seconds…'
  if (agents.length === 0) return platform

  return agents.map((agent) => AGENT_PROVIDER[agent.provider].label).join(' · ')
}

function BoxRow({
  teamId,
  device,
  agents,
  onChanged,
}: {
  teamId: string
  device: BoxDevice
  agents: RuntimeInstance[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [signingIn, setSigningIn] = useState<RuntimeInstance | null>(null)
  const { state } = device.box
  const badge = BOX_BADGE[state]
  const actions = boxActions(state)
  const run = async (title: string, action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      onChanged()
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    } catch (error) {
      toast.apiError(title, error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-52 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zGray-800/70 bg-main">
          <Box className="h-4 w-4 text-secondary" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-main" title={device.label}>
            {device.label}
          </div>
          <div className="truncate text-[12px] text-tertiary">
            {boxDetail(state, agents, device.platform)}
          </div>
        </div>
      </div>
      <span
        role="status"
        className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-secondary"
      >
        {state === 'creating' ? (
          <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
        ) : (
          <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_DOT[badge.tone])} />
        )}
        {badge.label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {state === 'running' &&
          agents
            .filter((agent) => agent.local?.signedIn !== true)
            .map((agent) => (
              <Button key={agent.id} size="sm" onClick={() => setSigningIn(agent)}>
                Sign in {AGENT_PROVIDER[agent.provider].label}
              </Button>
            ))}
        {actions.pause && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void run('Could not pause Box', () => api.boxPause(device.deviceId))}
          >
            Pause
          </Button>
        )}
        {actions.resume && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void run('Could not resume Box', () => api.boxResume(device.deviceId))}
          >
            Resume
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${device.label}?`}
        description="This permanently deletes the Box, its files and its agents' sign-ins, and stops conversations running on it. Your conversation history stays in Nuphos."
        destructive
        confirmLabel="Delete Box"
        onConfirm={() => run('Could not delete Box', () => api.boxDelete(device.deviceId))}
        onClose={() => setConfirmDelete(false)}
      />
      {signingIn && (
        <RuntimeLoginDialog
          teamId={teamId}
          instance={signingIn}
          onClose={() => {
            setSigningIn(null)
            window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
          }}
        />
      )}
    </li>
  )
}
