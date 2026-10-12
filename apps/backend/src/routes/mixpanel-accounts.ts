import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  accessView,
  bindingAccessUpdateSchema,
  createBinderOnlyAccess,
  normalizeAccessInput,
} from '@/lib/byos/access'
import {
  credentialsFromBinding,
  MIXPANEL_REGIONS,
  mixpanelHosts,
  verifyMixpanelCredentials,
  MixpanelApiError,
} from '@/lib/byos/mixpanel'
import { encryptMixpanelSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  requireMixpanelAccount,
  requireMixpanelMemberAccess,
  requireTeamRole,
} from '@/middleware/auth'
import { emptyTeamByosBindings, teamByosBindings } from '@/models'

import type { MixpanelAccountVariables, TeamAuthVariables } from '@/middleware/auth'
import type { MixpanelAccountBinding } from '@/models'

export const mixpanelAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Mixpanel binds with a service account username + secret (Organization
// Settings → Service Accounts). No OAuth. The secret is shown once by Mixpanel,
// and the service account reaches every project it was granted a role on.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    username: z.string().trim().min(1).max(200),
    secret: z.string().trim().min(1).max(400),
    region: z.enum(MIXPANEL_REGIONS),
  })
  .strict()

export function publicView(binding: MixpanelAccountBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    username: binding.username,
    region: binding.region,
    createdAt: binding.createdAt,
  }
}

mixpanelAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { mixpanelAccounts: 1 } },
  )

  return c.json({ accounts: (doc?.mixpanelAccounts ?? []).map(publicView) })
})

mixpanelAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, username, secret, region } = c.req.valid('json')

    await verifyMixpanelCredentials({ username, secret, region }).catch((err: unknown) => {
      if (err instanceof MixpanelApiError && (err.status === 401 || err.status === 403)) {
        throw new AppError(
          400,
          'invalid_mixpanel_credentials',
          'The Mixpanel service account username or secret is invalid, or it belongs to another data residency.',
        )
      }
      const message = err instanceof Error ? err.message : 'unknown error'

      throw new AppError(
        502,
        'mixpanel_api_unavailable',
        `Could not reach the Mixpanel API: ${message}`,
      )
    })

    const now = new Date()
    const binding: MixpanelAccountBinding = {
      id: new ObjectId(),
      label,
      username,
      encryptedSecret: encryptMixpanelSecret(secret),
      region,
      createdAt: now,
      // Starts closed (binder only), unlike the `['*']` default elsewhere: an
      // Mixpanel service account reaches every project it has a role on, so a
      // new binding must not silently expose that analytics data to the team.
      // Team admins are granted at the gate, not stored here.
      access: createBinderOnlyAccess(c.get('userId'), now),
    }

    // Dedup atomically rather than read-then-write: `username` is excluded in the
    // filter, so a concurrent bind of the same account can't slip between a
    // pre-check and the $push. When the account is already bound the filter
    // misses, upsert then tries to insert a second doc with this _id, and Mongo
    // rejects it with a duplicate-key error — which is the 409.
    await teamByosBindings()
      .updateOne(
        { _id: teamId, 'mixpanelAccounts.username': { $ne: username } },
        {
          $push: { mixpanelAccounts: binding },
          $set: { updatedAt: now },
          $setOnInsert: emptyTeamByosBindings(),
        },
        { upsert: true },
      )
      .catch((err: unknown) => {
        if ((err as { code?: number }).code === 11000) {
          throw new AppError(
            409,
            'mixpanel_account_already_bound',
            'This Mixpanel account is already bound',
          )
        }
        throw err
      })

    return c.json(publicView(binding), 201)
  },
)

const accountScoped = new Hono<{ Variables: MixpanelAccountVariables }>()

accountScoped.use('*', requireMixpanelAccount())

accountScoped.get('/', (c) => {
  return c.json({
    id: c.get('mixpanelAccountId'),
    label: c.get('mixpanelAccountLabel'),
    username: c.get('mixpanelBinding').username,
    region: c.get('mixpanelBinding').region,
  })
})

accountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = new ObjectId(c.get('mixpanelAccountId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { mixpanelAccounts: { id: accountId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'mixpanel_account_not_bound', 'Mixpanel account not found')
  }

  return c.body(null, 204)
})

accountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('mixpanelAccess'))),
)

accountScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = new ObjectId(c.get('mixpanelAccountId'))
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'mixpanelAccounts.id': accountId },
      { $set: { 'mixpanelAccounts.$.access': access, updatedAt: new Date() } },
    )

    // Guard the concurrent-delete race: if the binding was removed between the
    // middleware fetch and this write, don't report success for a no-op.
    if (res.matchedCount === 0) {
      throw new AppError(404, 'mixpanel_account_not_bound', 'Mixpanel account not found')
    }

    return c.json(accessView(access))
  },
)

// Agent credential handout, mirroring notion-integrations /credentials: the
// sandbox exchanges its NUPHOS_TOKEN for the binding's service account and
// queries Mixpanel directly. Gated by the per-binding member allow-list.
accountScoped.get('/credentials', requireMixpanelMemberAccess(), (c) => {
  const binding = c.get('mixpanelBinding')
  const creds = credentialsFromBinding(binding)

  // A reusable credential over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
    label: binding.label,
    username: creds.username,
    secret: creds.secret,
    region: creds.region,
    ...mixpanelHosts(creds.region),
    authType: 'mixpanel_basic',
  })
})

mixpanelAccountsRoutes.route('/:accountId', accountScoped)
