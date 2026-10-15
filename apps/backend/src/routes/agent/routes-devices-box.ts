import { readBoxMetrics } from '@/lib/agent/devices/box-metrics'
import { boxDesktopUrl, machineStates } from '@/lib/agent/devices/box-instabox'
import { renameAgentDevice } from '@/lib/agent/devices/store'
import { Hono } from 'hono'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { AgentDeviceRouteDependencies } from './routes-devices'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

// Boxes: cloud machines made for the caller, listed and driven as their devices.

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const boxCreateSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  teamId: z.string().trim().min(1).max(64).optional(),
})

/** What a client sees of a device: never the credential hash. */
function deviceView(device: AgentDevice, online: boolean, machine?: string) {
  return {
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    ...(device.model ? { model: device.model } : {}),
    allowLocalExec: device.allowLocalExec,
    online,
    createdAt: device.createdAt.toISOString(),
    ...(device.box
      ? {
          box: {
            provider: device.box.provider,
            sandboxId: device.box.sandboxId,
            // instabox's machine state is the Box's state; whether its agents are connected is `online`.
            state: !device.box.sandboxId || machine === undefined ? 'creating' : machine === 'running' ? 'running' : machine === 'suspended' || machine === 'paused' ? 'paused' : machine === 'error' ? 'error' : 'creating',
            joined: Boolean(device.credentialHash),
            updatedAt: device.box.updatedAt.toISOString(),
          },
        }
      : {}),
  }
}

export function createAgentDeviceBoxRoutes(deps: AgentDeviceRouteDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const requireBoxes = () => {
    if (!deps.box)
      throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

    return deps.box
  }
  const requireBackendUrl = () => {
    const url = deps.backendUrl()

    if (!url)
      throw new AppError(
        503,
        'box_unavailable',
        'This deployment has no public URL for a Box to reach',
      )

    return url
  }

  // The caller's own devices, online or not; Boxes carry their machine state.
  routes.get('/devices', async (c) => {
    const userId = c.get('userId')
    const demand = c.req.query('metrics') === 'true'
    const devices = await deps.listDevices(userId)
    const machines = deps.box && devices.some((d) => d.box) ? await machineStates() : new Map<string, string>()
    const backendUrl = deps.backendUrl()

    return c.json({
      boxAvailable: Boolean(deps.box) && Boolean(backendUrl),
      devices: await Promise.all(
        devices.map(async (device) => {
          const online = await deps.isOnline(userId, device.deviceId)
          const machine = device.box?.sandboxId ? machines.get(device.box.sandboxId) : undefined

          return {
            ...deviceView(device, online, machine),
            ...(online
              ? await readBoxMetrics(userId, device.deviceId, demand)
              : { metrics: null, metricsStatus: 'offline', metricsReceivedAt: null }),
          }
        }),
      ),
    })
  })

  // The Box's desktop, to watch and take over what its agents do.
  routes.post('/devices/:deviceId/box/desktop', async (c) => {
    requireBoxes()

    return c.json({ url: await boxDesktopUrl(c.get('userId'), c.req.param('deviceId')) })
  })

  // Rename any of the caller's own Boxes, a cloud one or a computer.
  routes.patch('/devices/:deviceId', zv('json', z.object({ label: z.string().trim().min(1).max(200) })), async (c) => {
    const { label } = c.req.valid('json')
    if (!(await renameAgentDevice(c.get('userId'), c.req.param('deviceId'), label)))
      throw new AppError(404, 'device_not_found', 'No such Box')

    return c.json({ ok: true })
  })

  // A Box: a cloud machine made for this user, joined with its own one-time token.
  routes.post('/devices/boxes', zv('json', boxCreateSchema), async (c) => {
    const box = requireBoxes()
    const backendUrl = requireBackendUrl()
    const { label, teamId: requestedTeamId } = c.req.valid('json')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, requestedTeamId))

    if (!teamId) throw new AppError(400, 'team_required', 'A Box is made inside one of your teams')
    // Unnamed Boxes count up: Box 1, Box 2, … after the highest one this user has.
    const taken = (await deps.listDevices(c.get('userId'))).map((d) => /^Box (\d+)$/u.exec(d.label)?.[1]).filter(Boolean)
    const name = label ?? `Box ${String(Math.max(0, ...taken.map(Number)) + 1)}`
    const device = await box.create(c.get('userId'), teamId, name, backendUrl)

    return c.json(deviceView(device, false), 201)
  })

  routes.post('/devices/:deviceId/box/pause', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const device = await requireBoxes().pause(userId, c.req.valid('param').deviceId)

    return c.json(deviceView(device, await deps.isOnline(userId, device.deviceId)))
  })

  routes.post('/devices/:deviceId/box/resume', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const device = await requireBoxes().resume(
      userId,
      c.req.valid('param').deviceId,
      requireBackendUrl(),
    )

    return c.json(deviceView(device, await deps.isOnline(userId, device.deviceId)))
  })

  // Deletes the machine, revokes its credential and forgets the device.
  routes.delete('/devices/:deviceId/box', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const { deviceId } = c.req.valid('param')

    await requireBoxes().destroy(userId, deviceId)
    if (await deps.revokeCredential(userId, deviceId)) await deps.disconnect(userId, deviceId)
    await deps.deleteDevice(userId, deviceId)

    return c.json({ ok: true })
  })

  return routes
}
