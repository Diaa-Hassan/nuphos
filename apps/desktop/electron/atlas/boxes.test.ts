import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

let subscribed = false

mock.module('./client.ts', {
  namedExports: {
    call: () => Promise.resolve({ billingUrl: 'https://billing.test', subscribed }),
    readToken: () => Promise.resolve('session'),
  },
})
const { boxBillingPage } = await import('./boxes.ts')

function answer(pages: Record<string, [number, unknown]>) {
  const seen: string[] = []

  mock.method(globalThis, 'fetch', (url: string) => {
    const page = url.split('/').pop() ?? ''
    const [status, body] = pages[page] ?? [500, {}]

    seen.push(page)

    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  })

  return seen
}

test('a team without a subscription goes to Checkout for the chosen vCPUs', async () => {
  subscribed = false
  const seen = answer({ checkout: [200, { url: 'https://checkout' }] })

  assert.deepEqual(await boxBillingPage('t1', 12), { url: 'https://checkout' })
  assert.deepEqual(seen, ['checkout'])
})

test('already subscribed falls back to the portal', async () => {
  const seen = answer({
    checkout: [409, { error: 'already_subscribed' }],
    portal: [200, { url: 'https://portal' }],
  })

  assert.deepEqual(await boxBillingPage('t1', 4), { url: 'https://portal' })
  assert.deepEqual(seen, ['checkout', 'portal'])
})

test('a checkout in progress says so and does not open the portal', async () => {
  const seen = answer({ checkout: [409, { error: 'checkout_in_progress' }] })

  await assert.rejects(boxBillingPage('t1', 4), /already in progress/)
  assert.deepEqual(seen, ['checkout'])
})

test('a subscribed team goes straight to the portal', async () => {
  subscribed = true
  const seen = answer({ portal: [200, { url: 'https://portal' }] })

  assert.deepEqual(await boxBillingPage('t1'), { url: 'https://portal' })
  assert.deepEqual(seen, ['portal'])
})
