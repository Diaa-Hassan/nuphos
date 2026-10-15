// A team's vCPU limit, applied where a Box starts: the vCPUs of its running Boxes,
// as instabox reports them, must stay within it. The limit is the team document's
// `boxVcpuLimit`, written by a separate billing service, else the deployment default.

import { randomUUID } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { teams } from '@/lib/identity/shared'

import { BOX_TEMPLATE, teamMachines, templateVcpus } from './box-instabox-client'
import { assertWithinLimit, runningVcpus } from './box-vcpu'
import { countTeamBoxesOrdering } from './store'

/** The team's limit and whether its own document sets it; undefined limit is unlimited. */
export async function teamVcpuLimit(teamId: string) {
  const team = await teams().findOne(
    { _id: new ObjectId(teamId) },
    { projection: { boxVcpuLimit: 1 } },
  )
  const own = team?.boxVcpuLimit

  return { limit: own ?? config.box.defaultVcpuLimit, own: own !== undefined }
}

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

/** How long a start may hold the team's start lease if it never releases it. */
const LEASE_MS = 60_000
/** How long a start waits for another start in the same team. */
const LEASE_WAIT_MS = 10_000

async function acquireStartLease(teamId: string): Promise<string | null> {
  const token = randomUUID()
  const deadline = Date.now() + LEASE_WAIT_MS

  do {
    const now = new Date()
    const result = await teams().updateOne(
      { _id: new ObjectId(teamId), $nor: [{ 'boxStartLease.until': { $gt: now } }] },
      { $set: { boxStartLease: { token, until: new Date(now.getTime() + LEASE_MS) } } },
    )

    if (result.matchedCount > 0) return token
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (Date.now() < deadline)

  return null
}

/**
 * Starts a Box, new or `resumed`, only within the team's limit. One start per team
 * at a time: the check and the start are not atomic, so two starts must not race.
 */
export async function startWithinLimit<T>(
  teamId: string,
  resumed: string | undefined,
  start: () => Promise<T>,
): Promise<T> {
  const { limit } = await teamVcpuLimit(teamId)

  if (limit === undefined) return start()
  const token = await acquireStartLease(teamId)

  if (!token)
    throw new AppError(409, 'box_starting', 'Another Box in this team is starting; try again')
  try {
    const { self, boxVcpus, usedVcpus } = await teamBoxUsage(teamId, resumed)

    // Already running: resuming starts nothing new.
    if (!self || runningVcpus([self]) === 0) assertWithinLimit(limit, usedVcpus, boxVcpus)

    return await start()
  } finally {
    // Only our own lease: one that expired may already be someone else's.
    await teams().updateOne(
      { _id: new ObjectId(teamId), 'boxStartLease.token': token },
      { $unset: { boxStartLease: '' } },
    )
  }
}

/** What the Boxes section shows: use against the limit, and where to upgrade. */
export async function boxUsageView(teamId: string) {
  const { limit, own } = await teamVcpuLimit(teamId)
  // An instabox outage leaves usage unknown rather than failing the read.
  const usage =
    limit !== undefined && config.box.instabox ? await teamBoxUsage(teamId).catch(() => null) : null

  return {
    /** Null when unlimited. */
    limitVcpus: limit ?? null,
    /** Whether the limit comes from the team's own subscription. */
    subscribed: own,
    usedVcpus: usage?.usedVcpus ?? null,
    boxVcpus: usage?.boxVcpus ?? null,
    billingUrl: config.box.billingUrl ?? null,
  }
}
