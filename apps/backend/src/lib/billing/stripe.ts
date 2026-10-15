// Stripe for Box plans: one customer per team, Checkout to buy a plan, the
// Customer Portal for everything after (switching plans, cards, invoices,
// cancelling), and the team's plan projected from its subscriptions.

import { ObjectId } from 'mongodb'
import Stripe from 'stripe'

import { config } from '@/config'
import { boxPlan, selectBoxPlan } from '@/lib/billing/box-plans'
import { AppError } from '@/lib/errors'
import { teams } from '@/lib/identity/shared'

import type { BoxPlan, BoxPlanId, BoxPlanProjection } from '@/lib/billing/box-plans'

/** Where Checkout and the portal send the browser back to. */
const RETURN_URL = 'https://nuphos.ai'

let client: Stripe | null = null

export function stripe(): Stripe {
  if (!config.box.stripe) throw new AppError(503, 'billing_unavailable', 'Billing is not enabled')
  client ??= new Stripe(config.box.stripe.secretKey, { appInfo: { name: 'nuphos-backend' } })

  return client
}

async function teamDoc(teamId: string) {
  const team = ObjectId.isValid(teamId)
    ? await teams().findOne({ _id: new ObjectId(teamId), deletedAt: { $exists: false } })
    : null

  if (!team) throw new AppError(404, 'team_not_found', 'Team not found')

  return team
}

/** The team's Stripe customer, made once; a customer made by a losing racer is deleted. */
async function ensureCustomer(teamId: string): Promise<string> {
  const team = await teamDoc(teamId)

  if (team.billing?.stripeCustomerId) return team.billing.stripeCustomerId
  const created = await stripe().customers.create({
    name: team.name,
    email: team.contactEmails[0],
    metadata: { teamId },
  })
  const claimed = await teams().findOneAndUpdate(
    { _id: team._id, 'billing.stripeCustomerId': { $exists: false } },
    { $set: { 'billing.stripeCustomerId': created.id, updatedAt: new Date() } },
  )

  if (claimed) return created.id
  await stripe()
    .customers.del(created.id)
    .catch(() => undefined)

  return (await teamDoc(teamId)).billing?.stripeCustomerId ?? created.id
}

/** Projects the customer's subscriptions onto its team; returns the team's plan. */
export async function reconcileBoxPlan(customerId: string): Promise<BoxPlanProjection | null> {
  const subscriptions = await stripe()
    .subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    .autoPagingToArray({ limit: 1_000 })
  const projection = selectBoxPlan(subscriptions)

  await teams().updateOne(
    { 'billing.stripeCustomerId': customerId },
    projection
      ? { $set: { 'billing.boxPlan': projection } }
      : { $unset: { 'billing.boxPlan': '' } },
  )

  return projection
}

/**
 * The team's plan; undefined when it has none. With billing off there are no
 * plans and Boxes are not capped, which `null` says. A team with a customer
 * but no projected plan asks Stripe again, so a lost webhook heals on the next read.
 */
export async function teamBoxPlan(teamId: string): Promise<BoxPlan | null | undefined> {
  if (!config.box.stripe) return null
  const { billing } = await teamDoc(teamId)

  if (billing?.boxPlan) return boxPlan(billing.boxPlan.plan)
  if (!billing?.stripeCustomerId) return undefined

  return boxPlan((await reconcileBoxPlan(billing.stripeCustomerId))?.plan)
}

/** A Checkout page for a team without a plan; a team with one changes it in the portal. */
export async function boxPlanCheckoutUrl(teamId: string, planId: BoxPlanId): Promise<string> {
  if (await teamBoxPlan(teamId))
    throw new AppError(409, 'box_plan_exists', 'The team has a plan; change it in the portal')
  const plan = boxPlan(planId)
  const prices = await stripe().prices.list({ lookup_keys: [plan?.lookupKey ?? ''], active: true })
  const price = prices.data[0]

  if (!price) throw new AppError(503, 'billing_unavailable', `No Stripe price for ${planId}`)
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: await ensureCustomer(teamId),
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: RETURN_URL,
    cancel_url: RETURN_URL,
  })

  if (!session.url) throw new AppError(502, 'stripe_error', 'Stripe returned no Checkout URL')

  return session.url
}

export async function boxPlanPortalUrl(teamId: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({
    customer: await ensureCustomer(teamId),
    return_url: RETURN_URL,
  })

  return session.url
}
