import clsx from 'clsx'
import { Ellipsis, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { AGENT_PROVIDER } from '../../types/runtime'

import { MachineIcon } from './BoxParts'
import { BOX_BADGE, boxActions, boxDetail, boxState, machineLine } from './boxPresentation'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { STATUS_DOT } from './runtimePresentation'

import type { AgentDevice } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'

/** One machine in the Boxes list: its state, its agents and what can be done to it. */
export function BoxRow({
  thisComputer,
  teamId,
  device,
  agents,
  onChanged,
  onSignIn,
}: {
  thisComputer: boolean
  teamId: string
  device: AgentDevice
  agents: RuntimeInstance[]
  onChanged: () => void
  /** A sign-in dialog opened or closed. */
  onSignIn: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
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

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-52 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zGray-800/70 bg-main">
          <MachineIcon device={device} />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-main" title={device.label}>
              {device.label}
            </span>
            {thisComputer && (
              <span className="shrink-0 rounded border border-zGray-700 px-1 text-[10.5px] text-secondary">
                This Computer
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-tertiary">
            {machineLine(device)} · {boxDetail(state, agents, device.platform)}
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
        {actions.resume && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void run('Could not resume Box', () => api.boxResume(device.deviceId))}
          >
            {state === 'error' ? 'Retry' : 'Resume'}
          </Button>
        )}
        {(actions.pause || actions.remove) && (
          <Menu>
            <MenuTrigger
              aria-label={`Manage ${device.label}`}
              disabled={busy}
              className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
            >
              <Ellipsis className="h-4 w-4" />
            </MenuTrigger>
            <MenuContent align="end">
              {actions.pause && (
                <MenuItem
                  onClick={() =>
                    void run('Could not pause Box', () => api.boxPause(device.deviceId))
                  }
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
        )}
      </div>
      {state === 'running' && agents.length > 0 && (
        <ul className="basis-full space-y-1 pl-12">
          {agents.map((agent) => (
            <li key={agent.id} className="flex items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-main">
                {AGENT_PROVIDER[agent.provider].label}
              </span>
              {agent.local?.signedIn === true ? (
                <span className="text-[11.5px] text-tertiary">Signed in</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSigningIn(agent)
                    onSignIn(true)
                  }}
                >
                  Sign in
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
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
