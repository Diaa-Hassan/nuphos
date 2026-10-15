// Paid Box plans: a team's plan caps the vCPUs of its running Boxes. Each plan is
// a monthly Stripe price found by its lookup key; the team's plan is projected
// from its Stripe subscriptions, never typed in.

import { AppError } from '@/lib/errors'

export const BOX_PLANS = [
  { id: 'box-20', usd: 20, vcpus: 4, lookupKey: 'nuphos_box_4vcpu_monthly' },
  { id: 'box-50', usd: 50, vcpus: 12, lookupKey: 'nuphos_box_12vcpu_monthly' },
  { id: 'box-100', usd: 100, vcpus: 24, lookupKey: 'nuphos_box_24vcpu_monthly' },
] as const

export type BoxPlan = (typeof BOX_PLANS)[number]
export type BoxPlanId = BoxPlan['id']

/** What the team document keeps of its subscription. */
export type BoxPlanProjection = { plan: BoxPlanId; subscriptionId: string; status: string }

/** Statuses that keep the plan: a failed renewal keeps it while Stripe retries. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

type SubscriptionLike = {
  id: string
  status: string
  created: number
  items: { data: { price: { lookup_key: string | null } }[] }
}

export function boxPlan(id: string | undefined): BoxPlan | undefined {
  return BOX_PLANS.find((plan) => plan.id === id)
}

/**
 * The plan a team has, from all of its customer's subscriptions rather than the
 * one an event carried: a late event about an old subscription cannot clear a
 * newer one. A live subscription on a known price wins; the largest, then newest.
 */
export function selectBoxPlan(subscriptions: SubscriptionLike[]): BoxPlanProjection | null {
  const candidates = subscriptions.flatMap((sub) => {
    const plan = BOX_PLANS.find((p) => p.lookupKey === sub.items.data[0]?.price.lookup_key)

    return plan && LIVE_STATUSES.has(sub.status) ? [{ sub, plan }] : []
  })

  candidates.sort((a, b) => b.plan.vcpus - a.plan.vcpus || b.sub.created - a.sub.created)
  const best = candidates[0]

  return best ? { plan: best.plan.id, subscriptionId: best.sub.id, status: best.sub.status } : null
}

/** Machine states that use their vCPUs; paused, stopped and gone machines do not. */
const RUNNING_STATES = new Set(['creating', 'starting', 'running', 'resuming'])

export function runningVcpus(machines: { state: string; vcpus: number }[]): number {
  return machines.reduce((sum, m) => sum + (RUNNING_STATES.has(m.state) ? m.vcpus : 0), 0)
}

/** Refuses starting a Box of `vcpus` when the team's running Boxes would exceed its plan. */
export function assertWithinPlan(plan: BoxPlan | undefined, usedVcpus: number, vcpus: number) {
  if (!plan)
    throw new AppError(402, 'box_plan_required', 'Boxes need a Box plan; upgrade to start one')
  if (usedVcpus + vcpus > plan.vcpus)
    throw new AppError(
      402,
      'box_plan_limit',
      `This Box needs ${String(vcpus)} vCPU, and your team's running Boxes already use ${String(usedVcpus)} of the ${String(plan.vcpus)} in its $${String(plan.usd)} plan. Pause a Box or upgrade the plan.`,
    )
}
