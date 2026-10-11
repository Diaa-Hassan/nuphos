// A boat sandbox bills while it runs, so one nobody has used for a while is
// stopped, and the next message resumes it before the turn reaches the runtime.

import { logError } from '@/lib/observability'

import { boatApiKey, resumeBoatRuntime as resume, stopBoatSandbox as stop } from './runtime-boat'
import { runtimes } from './runtime-registry'
import { hasActiveRuntimeTurn } from './runtime-rollout'

const IDLE_MS = 15 * 60_000
const SWEEP_MS = 60_000
// How long after a stop is claimed its call to boat can still be on the way.
const CLAIM_MS = 2 * 60_000

type Deps = {
  resume: typeof resume
  stop: typeof stop
  hasActiveTurn: typeof hasActiveRuntimeTurn
}
const defaults: Deps = { resume, stop, hasActiveTurn: hasActiveRuntimeTurn }

/** Whether the runtime's sandbox is stopped for being idle, so only a turn can reach it. */
export async function boatRuntimeAsleep(
  teamId: string | undefined,
  runtimeId: string | undefined,
): Promise<boolean> {
  if (!teamId || !runtimeId || !boatApiKey()) return false

  return Boolean(
    await runtimes().findOne({ _id: runtimeId, teamId, boatStoppedAt: { $exists: true } }),
  )
}

/** Called as a turn starts: records the use, and resumes a sandbox stopped for being idle. */
export async function wakeBoatRuntime(
  teamId: string,
  runtimeId: string | undefined,
  deps: Deps = defaults,
): Promise<void> {
  if (!runtimeId || !boatApiKey()) return
  const filter = { _id: runtimeId, teamId, boatSandboxId: { $exists: true } }
  // One write that both records the use and reads the stop flag: a sweep either
  // claimed the row before it, and is seen here, or loses its claim to it.
  const runtime = await runtimes().findOneAndUpdate(
    filter,
    { $set: { boatUsedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!runtime?.boatSandboxId || !runtime.boatStoppedAt) return
  const resumed = await deps.resume(runtime.boatSandboxId, runtime.url)

  // A sandbox that was still running had its stop claimed but not issued yet:
  // the stop is about to land, so the flag stays for the next turn. Past
  // `CLAIM_MS` no stop is coming and the flag is a leftover.
  if (!resumed && Date.now() - runtime.boatStoppedAt.getTime() < CLAIM_MS) return
  await runtimes().updateOne(filter, {
    $set: { boatUsedAt: new Date() },
    $unset: { boatStoppedAt: '' },
  })
}

/** Stops every running sandbox whose runtime has had no turn for `IDLE_MS`. */
export async function stopIdleBoatRuntimes(deps: Deps = defaults, now = new Date()): Promise<void> {
  const idle = await runtimes()
    .find({
      boatSandboxId: { $exists: true },
      boatStoppedAt: { $exists: false },
      boatUsedAt: { $lte: new Date(now.getTime() - IDLE_MS) },
    })
    .toArray()

  for (const runtime of idle) {
    const { _id, teamId, boatSandboxId, boatUsedAt } = runtime

    if (!boatSandboxId) continue
    try {
      // A long turn starts once and then runs; it counts as use for as long as it lasts.
      if (await deps.hasActiveTurn(teamId, _id)) {
        await runtimes().updateOne({ _id, teamId }, { $set: { boatUsedAt: now } })
        continue
      }
      // Replicas sweep concurrently and a turn may start meanwhile; only an untouched row is claimed.
      const claimed = await runtimes().updateOne(
        { _id, teamId, boatUsedAt, boatStoppedAt: { $exists: false } },
        { $set: { boatStoppedAt: now } },
      )

      if (claimed.modifiedCount === 0) continue
      await deps.stop(boatSandboxId).catch(async (error: unknown) => {
        await runtimes().updateOne({ _id, teamId }, { $unset: { boatStoppedAt: '' } })
        throw error
      })
    } catch (error) {
      logError('openab.boat.idle_stop_failed', error, { team_id: teamId, runtime_id: _id })
    }
  }
}

let sweep: ReturnType<typeof setInterval> | undefined

export function initBoatIdleStop(): boolean {
  shutdownBoatIdleStop()
  if (!boatApiKey()) return false
  sweep = setInterval(() => void stopIdleBoatRuntimes(), SWEEP_MS)

  return true
}

export function shutdownBoatIdleStop(): void {
  if (sweep) clearInterval(sweep)
  sweep = undefined
}
