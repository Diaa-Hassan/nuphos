import { Box, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'

import { JoinDialog } from './BoxParts'
import { boxAgents, boxPollMs, machines, vanishedBoxes } from './boxPresentation'
import { BoxRow } from './BoxRow'
import { PanelHeading } from './RuntimePanel'
import { useAgentDevices } from './useAgentDevices'

import type { BoxJoin } from './BoxParts'
import type { AgentDevice, AgentDeviceList } from '../../api'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** The signed-in user's own Boxes, above the team's agents. Hidden when the backend has no Box provider. */
export function BoxSection({
  teamId,
  instances,
  quotas,
}: {
  teamId: string
  instances: RuntimeInstance[]
  quotas: ReadonlyMap<string, RuntimeQuota>
}) {
  const thisComputer = useThisComputer()
  const [creating, setCreating] = useState(false)
  const [join, setJoin] = useState<BoxJoin | null>(null)
  const previous = useRef<AgentDevice[]>([])
  // While a sign-in dialog is open, and for two minutes after, the agents' state changes on its own.
  const signInUntil = useRef(0)
  const { list, reload } = useAgentDevices((next: AgentDeviceList) =>
    boxPollMs(next.devices, Date.now() < signInUntil.current),
  )

  useEffect(() => {
    if (!list) return
    // The agents under each Box come from the runtime catalog: refresh it when the list changes.
    if (JSON.stringify(previous.current) !== JSON.stringify(list.devices))
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    for (const device of vanishedBoxes(previous.current, list.devices))
      toast.error('Box setup failed', `${device.label} could not start and was removed.`)
    previous.current = list.devices
  }, [list])

  const watchSignIn = (open: boolean) => {
    signInUntil.current = open ? Infinity : Date.now() + 2 * 60_000
    reload()
  }

  if (!list?.boxAvailable) return null

  const create = async () => {
    setCreating(true)
    try {
      await api.boxCreate(teamId)
      reload()
    } catch (error) {
      toast.apiError('Could not create Box', error)
    } finally {
      setCreating(false)
    }
  }
  const owned = machines(list.devices)

  return (
    <section aria-label="Boxes" className="mx-auto w-full max-w-5xl px-5 pt-5 lg:px-8">
      <PanelHeading
        title="Boxes"
        right={
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void api
                  .boxJoinToken()
                  .then(setJoin, (error: unknown) =>
                    toast.apiError('Could not make a join command', error),
                  )
              }
            >
              Connect external Box
            </Button>
            <Button type="submit" size="sm" variant="secondary" disabled={creating}>
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Box className="h-3.5 w-3.5" />
              )}
              New Box
            </Button>
          </form>
        }
      />
      {join && <JoinDialog join={join} onClose={() => setJoin(null)} />}
      {owned.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-2">
          {owned.map((device) => (
            <BoxRow
              thisComputer={thisComputer?.deviceId === device.deviceId}
              key={device.deviceId}
              teamId={teamId}
              device={device}
              agents={boxAgents(device.deviceId, instances)}
              quotas={quotas}
              onChanged={reload}
              onSignIn={watchSignIn}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
