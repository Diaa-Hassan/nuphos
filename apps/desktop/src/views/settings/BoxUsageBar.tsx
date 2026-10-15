import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { BOX_VCPU_TIERS } from './boxPresentation'

import type { BoxUsage } from '../../api/device-types'

/** The team's running vCPUs against its limit; administrators upgrade through the billing service. */
export function BoxUsageBar({
  teamId,
  isAdmin,
  usage,
}: {
  teamId: string
  isAdmin: boolean
  usage: BoxUsage
}) {
  const [busy, setBusy] = useState(false)
  const open = async (vcpus?: number) => {
    setBusy(true)
    try {
      await api.appOpenExternal((await api.boxBillingPage(teamId, vcpus)).url)
    } catch (error) {
      toast.apiError('Could not open billing', error)
    } finally {
      setBusy(false)
    }
  }
  const canUpgrade = isAdmin && usage.billingUrl !== null

  if (usage.limitVcpus === null) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-secondary">
      <span>
        {usage.usedVcpus === null
          ? `vCPU usage unavailable · limit ${String(usage.limitVcpus)} vCPU`
          : `${String(usage.usedVcpus)} of ${String(usage.limitVcpus)} vCPU running`}
      </span>
      {canUpgrade && usage.subscribed && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void open()}>
          Upgrade
        </Button>
      )}
      {canUpgrade &&
        !usage.subscribed &&
        BOX_VCPU_TIERS.map((vcpus) => (
          <Button
            key={vcpus}
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void open(vcpus)}
          >
            Upgrade to {vcpus} vCPU
          </Button>
        ))}
    </div>
  )
}
