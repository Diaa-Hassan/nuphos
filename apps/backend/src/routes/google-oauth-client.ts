import { Hono } from 'hono'
import { z } from 'zod'

import { encryptLinearSecret } from '@/lib/byos/secrets'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'

// The team's own Google OAuth client, which its members' Gmail and Google
// Drive Personal Credentials connect and refresh through. Members can see
// whether one is set; only admins change it, and the secret is never returned.
export const googleOAuthClientRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const clientSchema = z
  .object({
    clientId: z
      .string()
      .trim()
      .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/u, 'Expected a Google OAuth client ID'),
    clientSecret: z.string().trim().min(1).max(200),
  })
  .strict()

googleOAuthClientRoutes.get('/', async (c) => {
  const doc = await teamByosBindings().findOne(
    { _id: parseObjectId(c.get('teamId'), 'teamId') },
    { projection: { 'googleOAuthClient.clientId': 1 } },
  )

  return c.json({ clientId: doc?.googleOAuthClient?.clientId ?? null })
})

googleOAuthClientRoutes.put(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', clientSchema),
  async (c) => {
    const { clientId, clientSecret } = c.req.valid('json')
    const now = new Date()

    await teamByosBindings().updateOne(
      { _id: parseObjectId(c.get('teamId'), 'teamId') },
      {
        $set: {
          googleOAuthClient: {
            clientId,
            encryptedClientSecret: encryptLinearSecret(clientSecret),
            updatedAt: now,
            updatedBy: c.get('userId'),
          },
          updatedAt: now,
        },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json({ clientId })
  },
)

googleOAuthClientRoutes.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  await teamByosBindings().updateOne(
    { _id: parseObjectId(c.get('teamId'), 'teamId') },
    { $unset: { googleOAuthClient: '' } },
  )

  return c.body(null, 204)
})
