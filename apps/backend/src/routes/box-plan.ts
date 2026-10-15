import { Hono } from 'hono'
import { z } from 'zod'

import { config } from '@/config'
import { boxesEnabled, teamBoxUsage } from '@/lib/agent/devices/box-instabox'
import { BOX_PLANS } from '@/lib/billing/box-plans'
import {
  boxPlanCheckoutUrl,
  boxPlanPortalUrl,
  reconcileBoxPlan,
  stripe,
  teamBoxPlan,
} from '@/lib/billing/stripe'
import { logError } from '@/lib/observability'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { BoxPlanId } from '@/lib/billing/box-plans'
import type { TeamAuthVariables } from '@/middleware/auth'

const checkoutSchema = z.object({
  plan: z.enum(BOX_PLANS.map((plan) => plan.id) as [BoxPlanId, ...BoxPlanId[]]),
})

/** The team's Box plan and how much of it its running Boxes use. */
export const boxPlanRoutes = new Hono<{ Variables: TeamAuthVariables }>()

boxPlanRoutes.get('/', async (c) => {
  const teamId = c.get('teamId')
  const plan = await teamBoxPlan(teamId)
  // An instabox outage leaves usage unknown rather than failing the whole read.
  const usage =
    plan !== null && boxesEnabled() ? await teamBoxUsage(teamId).catch(() => null) : null

  return c.json({
    /** False when this deployment sells no plans; Boxes are then not capped. */
    enabled: plan !== null,
    plan: plan ? { id: plan.id, usd: plan.usd, vcpus: plan.vcpus } : null,
    plans: BOX_PLANS.map(({ id, usd, vcpus }) => ({ id, usd, vcpus })),
    /** Null when instabox could not be read. */
    usedVcpus: usage?.usedVcpus ?? null,
    /** The vCPUs a new Box takes; null when unknown. */
    boxVcpus: usage?.boxVcpus ?? null,
  })
})

boxPlanRoutes.post(
  '/checkout',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', checkoutSchema),
  async (c) =>
    c.json({
      url: await boxPlanCheckoutUrl(c.get('teamId'), c.req.valid('json').plan),
    }),
)

boxPlanRoutes.post('/portal', requireTeamRole('ADMINISTRATOR'), async (c) =>
  c.json({ url: await boxPlanPortalUrl(c.get('teamId')) }),
)

/**
 * Stripe's subscription events. Unauthenticated: the signature over the raw body
 * is the proof. Each event re-reads the customer's subscriptions rather than
 * trusting its own payload, so order and retries do not matter.
 */
export const stripeWebhookRoutes = new Hono()

stripeWebhookRoutes.post('/', async (c) => {
  const secret = config.box.stripe?.webhookSecret
  const signature = c.req.header('stripe-signature')

  if (!secret) return c.json({ error: 'billing_unavailable' }, 503)
  if (!signature) return c.json({ error: 'missing_signature' }, 400)
  let event

  try {
    event = await stripe().webhooks.constructEventAsync(await c.req.text(), signature, secret)
  } catch {
    return c.json({ error: 'invalid_signature' }, 400)
  }
  if (event.type.startsWith('customer.subscription.')) {
    const { customer } = event.data.object as { customer: string | { id: string } }

    try {
      await reconcileBoxPlan(typeof customer === 'string' ? customer : customer.id)
    } catch (error) {
      // 500: Stripe retries with backoff.
      logError('billing.webhook.failed', error, { event_type: event.type })

      return c.json({ error: 'handler_error' }, 500)
    }
  }

  return c.json({ received: true })
})
