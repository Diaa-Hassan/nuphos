import { useEffect, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'

import { BOX_CREATING_POLL_MS, boxAgents, boxSetupPhase } from './boxPresentation'

import type { AgentDevice } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'

/**
 * Makes a Box and waits for its agents to join the team. `deviceId` is the Box this flow made,
 * owned by the caller so it survives going back a step.
 */
export function useBoxSetup(
  teamId: string,
  deviceId: string | null,
  onCreated: (deviceId: string) => void,
) {
  const [creating, setCreating] = useState(false)
  const [devices, setDevices] = useState<AgentDevice[] | null>(null)
  const [agents, setAgents] = useState<RuntimeInstance[]>([])
  const phase = boxSetupPhase(deviceId, devices, agents)

  useEffect(() => {
    if (!deviceId || phase === 'ready' || phase === 'error') return
    let cancelled = false
    const timer = setTimeout(() => {
      void Promise.all([api.boxListDevices(), api.atlasListRuntimeInstances(teamId)]).then(
        ([list, instances]) => {
          if (cancelled) return
          const found = boxAgents(deviceId, instances)

          setDevices(list.devices)
          setAgents(found)
          if (found.length > 0) window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
        },
        // A failed check is retried by the next tick, which the unchanged state schedules.
        () => !cancelled && setDevices((previous) => (previous ? [...previous] : [])),
      )
    }, BOX_CREATING_POLL_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [teamId, deviceId, phase, devices])

  async function create(label?: string) {
    if (creating) return
    setCreating(true)
    try {
      onCreated((await api.boxCreate(teamId, label)).deviceId)
    } catch (error) {
      toast.apiError('Could not create Box', error)
    } finally {
      setCreating(false)
    }
  }

  return { phase, agents, creating, create }
}
