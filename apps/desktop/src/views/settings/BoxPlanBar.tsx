import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import type { BoxPlanStatus } from '../../api/device-types'

/** The team's plan and its running vCPUs, with the way to buy or change it. */
export function BoxPlanBar({ teamId, status }: { teamId: string; status: BoxPlanStatus }) {
  const [busy, setBusy] = useState(false)
  const open = async (page: () => Promise<{ url: string }>) => {
    setBusy(true)
    try {
      await api.appOpenExternal((await page()).url)
    } catch (error) {
      toast.apiError('Could not open billing', error)
    } finally {
      setBusy(false)
    }
  }

  if (!status.plan)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-secondary">
        <span>No plan.</span>
        {status.plans.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void open(() => api.boxPlanCheckout(teamId, option.id))}
          >
            ${option.usd}/mo · {option.vcpus} vCPU
          </Button>
        ))}
      </div>
    )

  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-secondary">
      <span>
        ${status.plan.usd}/mo plan · {status.usedVcpus} of {status.plan.vcpus} vCPU running
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => void open(() => api.boxPlanPortal(teamId))}
      >
        Upgrade
      </Button>
    </div>
  )
}
