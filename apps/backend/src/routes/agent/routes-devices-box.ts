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
async function deviceView(deps: AgentDeviceRouteDependencies, device: AgentDevice) {
  const online = await deps.isOnline(device.userId, device.deviceId)

  return {
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    allowLocalExec: device.allowLocalExec,
    online,
    createdAt: device.createdAt.toISOString(),
    ...(device.box && deps.box
      ? {
          box: {
            provider: device.box.provider,
            ...(device.box.sandboxId ? { sandboxId: device.box.sandboxId } : {}),
            state: await deps.box.state(device, online),
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

  // The caller's own devices, online or not; a Box carries its machine's state.
  routes.get('/devices', async (c) => {
    const userId = c.get('userId')
    const devices = await deps.listDevices(userId)

    return c.json({
      boxAvailable: deps.box?.available() ?? false,
      devices: await Promise.all(devices.map((device) => deviceView(deps, device))),
    })
  })

  // A Box: a cloud machine made for this user, joined with its own one-time token.
  routes.post('/devices/boxes', zv('json', boxCreateSchema), async (c) => {
    const box = requireBoxes()
    const { label, teamId: requestedTeamId } = c.req.valid('json')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, requestedTeamId))

    if (!teamId) throw new AppError(400, 'team_required', 'A Box is made inside one of your teams')
    const device = await box.create(c.get('userId'), teamId, label)

    return c.json(await deviceView(deps, device), 201)
  })

  routes.post('/devices/:deviceId/box/pause', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const device = await requireBoxes().pause(userId, c.req.valid('param').deviceId)

    return c.json(await deviceView(deps, device))
  })

  routes.post('/devices/:deviceId/box/resume', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const device = await requireBoxes().resume(userId, c.req.valid('param').deviceId)

    return c.json(await deviceView(deps, device))
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
