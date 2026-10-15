// A team's Box plan, applied where a Box starts: the vCPUs of its running Boxes,
// as instabox reports them, must stay within the plan.

import { ObjectId } from 'mongodb'

import { assertWithinPlan, runningVcpus } from '@/lib/billing/box-plans'
import { teamBoxPlan } from '@/lib/billing/stripe'
import { AppError } from '@/lib/errors'
import { teams } from '@/lib/identity/shared'

import { BOX_TEMPLATE, teamMachines, templateVcpus } from './box-instabox-client'
import { countTeamBoxesOrdering } from './store'

/**
 * vCPUs the team's running Boxes use, Boxes still being ordered included, and the
 * size of the Box about to start: the `resumed` machine's own, or a new one's.
 */
export async function teamBoxUsage(teamId: string, resumed?: string) {
  const [machines, ordering] = await Promise.all([
    teamMachines(teamId),
    countTeamBoxesOrdering(teamId),
  ])
  const self = machines.find((machine) => machine.sandboxId === resumed)
  const boxVcpus = self?.vcpus ?? (await templateVcpus(BOX_TEMPLATE))

  return { self, boxVcpus, usedVcpus: runningVcpus(machines) + ordering * boxVcpus }
}

/** How long a start may hold the team's start lock if it never releases it. */
const START_LOCK_MS = 60_000

async function lockBoxStart(teamId: string): Promise<boolean> {
  const now = new Date()
  const result = await teams().updateOne(
    { _id: new ObjectId(teamId), $nor: [{ boxStartLockUntil: { $gt: now } }] },
    { $set: { boxStartLockUntil: new Date(now.getTime() + START_LOCK_MS) } },
  )

  return result.matchedCount > 0
}

async function unlockBoxStart(teamId: string): Promise<void> {
  await teams().updateOne({ _id: new ObjectId(teamId) }, { $unset: { boxStartLockUntil: '' } })
}

/**
 * Starts a Box, new or `resumed`, only within the team's plan. One start per team
 * at a time: the check and the start are not atomic, so two starts must not race.
 */
export async function startWithinPlan<T>(
  teamId: string,
  resumed: string | undefined,
  start: () => Promise<T>,
): Promise<T> {
  const plan = await teamBoxPlan(teamId)

  if (plan === null) return start()
  if (!(await lockBoxStart(teamId)))
    throw new AppError(409, 'box_starting', 'Another Box in this team is starting; try again')
  try {
    const { self, boxVcpus, usedVcpus } = await teamBoxUsage(teamId, resumed)

    // Already running: resuming starts nothing new.
    if (!self || runningVcpus([self]) === 0) assertWithinPlan(plan, usedVcpus, boxVcpus)

    return await start()
  } finally {
    await unlockBoxStart(teamId)
  }
}
