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
  label: z.string().trim().min(1).max(200).default('Box'),
  teamId: z.string().trim().min(1).max(64).optional(),
})

/** What a client sees of a device: never the credential hash. */
function deviceView(device: AgentDevice, online: boolean) {
  return {
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    allowLocalExec: device.allowLocalExec,
    online,
    createdAt: device.createdAt.toISOString(),
    ...(device.box
      ? {
          box: {
            provider: device.box.provider,
            sandboxId: device.box.sandboxId,
            state: device.box.state,
            ...(device.box.error ? { error: device.box.error } : {}),
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
    const devices = await deps.listDevices(userId)

    return c.json({
      devices: await Promise.all(
        devices.map(async (device) =>
          deviceView(device, await deps.isOnline(userId, device.deviceId)),
        ),
      ),
    })
  })

  // A Box: a cloud machine made for this user, joined with its own one-time token.
  routes.post('/devices/boxes', zv('json', boxCreateSchema), async (c) => {
    const box = requireBoxes()
    const backendUrl = requireBackendUrl()
    const { label, teamId: requestedTeamId } = c.req.valid('json')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, requestedTeamId))

    if (!teamId) throw new AppError(400, 'team_required', 'A Box is made inside one of your teams')
    const device = await box.create(c.get('userId'), teamId, label, backendUrl)

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
