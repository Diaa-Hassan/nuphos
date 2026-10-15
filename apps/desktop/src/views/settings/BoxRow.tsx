import clsx from 'clsx'
import { Ellipsis } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { AGENT_PROVIDER } from '../../types/runtime'

import { MachineIcon } from './BoxParts'
import { BOX_BADGE, boxActions, boxState, machineLine } from './boxPresentation'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { inputClasses } from './styles'

import type { AgentDevice } from '../../api'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** One machine in the Boxes list: its state, its agents and what can be done to it. */
export function BoxRow({
  thisComputer,
  teamId,
  device,
  agents,
  quotas,
  onChanged,
  onSignIn,
}: {
  thisComputer: boolean
  teamId: string
  device: AgentDevice
  agents: RuntimeInstance[]
  quotas: ReadonlyMap<string, RuntimeQuota>
  onChanged: () => void
  /** A sign-in dialog opened or closed. */
  onSignIn: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState<RuntimeInstance | null>(null)
  const state = boxState(device)
  const cloud = device.box !== undefined
  const badge = BOX_BADGE[state]
  const actions = cloud ? boxActions(state) : { pause: false, resume: false, remove: false }
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

  const dim = state === 'paused' || state === 'stopped'
  const starting = state === 'creating' || (state === 'running' && agents.length === 0)

  return (
    <li className="flex h-[220px] w-[248px] shrink-0 flex-col rounded-xl border border-zGray-800/70 p-3">
      <div className="flex items-center gap-2">
        <MachineIcon device={device} />
        {renaming === null ? (
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium text-main"
            title={device.label}
          >
            {device.label}
          </span>
        ) : (
          <input
            autoFocus
            aria-label="Box name"
            value={renaming}
            maxLength={200}
            className={clsx(inputClasses, 'h-7 min-w-0 flex-1 text-[13px]')}
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={() => setRenaming(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(null)
              if (event.key !== 'Enter') return
              const label = renaming.trim()

              setRenaming(null)
              // This computer keeps its name locally and re-registers with it, so rename it there.
              if (label && label !== device.label)
                void run('Could not rename Box', () =>
                  thisComputer ? api.deviceSetLabel(label) : api.boxRename(device.deviceId, label),
                )
            }}
          />
        )}
        <span role="status" className="shrink-0 text-[11px] text-tertiary">
          {badge.label}
        </span>
        <Menu>
          <MenuTrigger
            aria-label={`Manage ${device.label}`}
            disabled={busy}
            className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
          >
            <Ellipsis className="h-4 w-4" />
          </MenuTrigger>
          <MenuContent align="end">
            {cloud && state === 'running' && (
              <MenuItem
                onClick={() =>
                  void run('Could not open the desktop', async () => {
                    const { url } = await api.boxDesktop(device.deviceId)
                    const href = pageLocationForNavigation(
                      emptyNavigation({ kind: 'team', teamId }, 'team.browser', {
                        browserUrl: url,
                      }),
                    ).href

                    window.dispatchEvent(new CustomEvent('nuphos:open-in-app', { detail: href }))
                  })
                }
              >
                Open desktop
              </MenuItem>
            )}
            <MenuItem onClick={() => setRenaming(device.label)}>Rename</MenuItem>
            {actions.resume && (
              <MenuItem
                onClick={() =>
                  void run('Could not resume Box', () => api.boxResume(device.deviceId))
                }
              >
                {state === 'error' ? 'Retry' : 'Resume'}
              </MenuItem>
            )}
            {actions.pause && (
              <MenuItem
                onClick={() => void run('Could not pause Box', () => api.boxPause(device.deviceId))}
              >
                Pause
              </MenuItem>
            )}
            {actions.remove && (
              <>
                <MenuSeparator />
                <MenuItem destructive onClick={() => setConfirmDelete(true)}>
                  Delete
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      </div>
      <div className={clsx('mt-1 truncate text-[11.5px] text-tertiary', dim && 'opacity-50')}>
        {[thisComputer && 'This Computer', machineLine(device)].filter(Boolean).join(' · ')}
      </div>
      <ul className={clsx('mt-auto flex gap-2 overflow-x-auto pb-1', dim && 'opacity-50')}>
        {starting
          ? [0, 1].map((slot) => (
              <li key={slot} className="h-[68px] w-[68px] shrink-0 rounded-lg bg-zGray-800/30" />
            ))
          : agents.map((agent) => (
              <AgentTile
                key={agent.id}
                agent={agent}
                quota={quotas.get(agent.id)}
                onSignIn={() => {
                  setSigningIn(agent)
                  onSignIn(true)
                }}
              />
            ))}
      </ul>
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
            onSignIn(false)
            window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
          }}
        />
      )}
    </li>
  )
}

/** One agent on a Box: its plan's first window, or what it still needs. */
function AgentTile({
  agent,
  quota,
  onSignIn,
}: {
  agent: RuntimeInstance
  quota: RuntimeQuota | undefined
  onSignIn: () => void
}) {
  const window = quota?.available ? quota.windows[0] : undefined
  const atLimit = quota?.available && quota.windows.some((w) => w.usedPercent >= 100)

  return (
    <li className="flex h-[68px] w-[68px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-zGray-800/40 px-1">
      <AgentProviderIcon provider={agent.provider} className="h-4 w-4" />
      <span className="w-full truncate text-center text-[10.5px] text-main">
        {AGENT_PROVIDER[agent.provider].label}
      </span>
      {agent.local?.signedIn !== true ? (
        <button
          type="button"
          onClick={onSignIn}
          className="text-[10px] text-zViolet-400 hover:underline"
        >
          Sign in
        </button>
      ) : atLimit ? (
        <span className="rounded-full bg-zOrangered-500/10 px-1.5 text-[10px] text-zOrangered-400">
          At limit
        </span>
      ) : (
        <span className="text-[10px] text-tertiary">
          {window ? `${window.label} ${String(Math.round(window.usedPercent))}%` : '—'}
        </span>
      )}
    </li>
  )
}
