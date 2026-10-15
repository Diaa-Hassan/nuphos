import { Box, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'

import { JoinDialog } from './BoxParts'
import { BoxRow } from './BoxRow'
import { boxAgents, boxPollMs, machines, vanishedBoxes } from './boxPresentation'
import { useAgentDevices } from './useAgentDevices'

import type { BoxJoin } from './BoxParts'
import type { AgentDevice, AgentDeviceList } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'

/** The signed-in user's own Boxes, above the team's agents. Hidden when the backend has no Box provider. */
export function BoxSection({
  teamId,
  instances,
}: {
  teamId: string
  instances: RuntimeInstance[]
}) {
  const thisComputer = useThisComputer()
  const [creating, setCreating] = useState(false)
  const [join, setJoin] = useState<BoxJoin | null>(null)
  const instancesRef = useRef(instances)
  const previous = useRef<AgentDevice[]>([])

  useEffect(() => {
    instancesRef.current = instances
  })

  // Quickly while a Box is starting or one of its agents is not signed in yet; never while hidden.
  const { list, reload } = useAgentDevices((next: AgentDeviceList) =>
    instancesRef.current.some(
      (instance) => instance.kind === 'local' && instance.local?.signedIn !== true,
    )
      ? 1_500
      : boxPollMs(next.devices),
  )

  useEffect(() => {
    if (!list) return
    // The agents under each Box come from the runtime catalog: refresh it with the list.
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    for (const device of vanishedBoxes(previous.current, list.devices))
      toast.error('Box setup failed', `${device.label} could not start and was removed.`)
    previous.current = list.devices
  }, [list])

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-main">Boxes</h2>
          <p className="mt-0.5 text-[12px] text-tertiary">
            Every computer your agents run on: cloud Boxes and your own Macs.
          </p>
        </div>
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
            variant="secondary"
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
      {join && <JoinDialog join={join} onClose={() => setJoin(null)} />}
      {owned.length > 0 && (
        <ul className="mt-3 divide-y divide-zGray-800/60 rounded-xl border border-zGray-800/70">
          {owned.map((device) => (
            <BoxRow
              thisComputer={thisComputer?.deviceId === device.deviceId}
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
