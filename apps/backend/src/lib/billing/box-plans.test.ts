import { describe, expect, test } from 'bun:test'

import { assertWithinPlan, boxPlan, runningVcpus, selectBoxPlan } from './box-plans'

const sub = (id: string, status: string, lookupKey: string | null, created = 1) => ({
  id,
  status,
  created,
  items: { data: [{ price: { lookup_key: lookupKey } }] },
})

describe('selectBoxPlan', () => {
  test('projects the live subscription on a known price', () => {
    expect(selectBoxPlan([sub('sub_1', 'active', 'nuphos_box_12vcpu_monthly')])).toEqual({
      plan: 'box-50',
      subscriptionId: 'sub_1',
      status: 'active',
    })
  })

  test('an old canceled subscription does not clear a newer active one', () => {
    expect(
      selectBoxPlan([
        sub('sub_new', 'active', 'nuphos_box_4vcpu_monthly', 2),
        sub('sub_old', 'canceled', 'nuphos_box_24vcpu_monthly', 1),
      ])?.subscriptionId,
    ).toBe('sub_new')
  })

  test('a failed renewal keeps the plan; an abandoned checkout does not grant one', () => {
    expect(selectBoxPlan([sub('a', 'past_due', 'nuphos_box_4vcpu_monthly')])?.plan).toBe('box-20')
    expect(selectBoxPlan([sub('b', 'incomplete', 'nuphos_box_4vcpu_monthly')])).toBeNull()
  })

  test('unknown prices and no subscriptions mean no plan', () => {
    expect(
      selectBoxPlan([sub('c', 'active', 'nuphos_pro_monthly'), sub('d', 'active', null)]),
    ).toBeNull()
    expect(selectBoxPlan([])).toBeNull()
  })

  test('the largest live plan wins, then the newest', () => {
    expect(
      selectBoxPlan([
        sub('small', 'active', 'nuphos_box_4vcpu_monthly', 3),
        sub('big', 'active', 'nuphos_box_24vcpu_monthly', 1),
      ])?.subscriptionId,
    ).toBe('big')
    expect(
      selectBoxPlan([
        sub('older', 'active', 'nuphos_box_12vcpu_monthly', 1),
        sub('newer', 'trialing', 'nuphos_box_12vcpu_monthly', 2),
      ])?.subscriptionId,
    ).toBe('newer')
  })
})

describe('Box vCPU cap', () => {
  test('only running machines count', () => {
    expect(
      runningVcpus([
        { state: 'running', vcpus: 4 },
        { state: 'resuming', vcpus: 4 },
        { state: 'suspended', vcpus: 4 },
        { state: 'stopped', vcpus: 4 },
        { state: 'deleted', vcpus: 4 },
      ]),
    ).toBe(8)
  })

  test('a Box that fits exactly is allowed; one more vCPU is refused', () => {
    const plan = boxPlan('box-50')

    expect(() => assertWithinPlan(plan, 8, 4)).not.toThrow()
    expect(() => assertWithinPlan(plan, 12, 4)).toThrow(
      expect.objectContaining({ status: 402, code: 'box_plan_limit' }),
    )
  })

  test('no plan means no Boxes', () => {
    expect(() => assertWithinPlan(undefined, 0, 4)).toThrow(
      expect.objectContaining({ status: 402, code: 'box_plan_required' }),
    )
  })

  test('the plans are $20 for 4, $50 for 12 and $100 for 24 vCPU', () => {
    expect(['box-20', 'box-50', 'box-100'].map((id) => boxPlan(id)?.vcpus)).toEqual([4, 12, 24])
  })
})
