import { afterEach, describe, expect, test } from 'bun:test'

import { MixpanelApiError, verifyMixpanelCredentials } from './mixpanel'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(status: number, body: string, capture?: (req: Request) => void) {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    capture?.(new Request(input as string, init))

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

const CREDS = {
  username: 'nuphos.abc123.mp-service-account',
  secret: 's3cret',
  region: 'us' as const,
}

describe('verifyMixpanelCredentials', () => {
  test('calls /api/app/me with HTTP Basic auth built from username:secret', async () => {
    let seen: Request | undefined

    stubFetch(200, '{"status":"ok","results":{}}', (req) => {
      seen = req
    })

    await verifyMixpanelCredentials(CREDS)

    expect(seen?.url).toBe('https://mixpanel.com/api/app/me')
    const expected = `Basic ${Buffer.from('nuphos.abc123.mp-service-account:s3cret').toString('base64')}`

    expect(seen?.headers.get('authorization')).toBe(expected)
  })

  test.each([
    ['eu', 'https://eu.mixpanel.com/api/app/me'],
    ['in', 'https://in.mixpanel.com/api/app/me'],
  ] as const)('verifies against the %s residency host', async (region, url) => {
    let seen: Request | undefined

    stubFetch(200, '{}', (req) => {
      seen = req
    })

    await verifyMixpanelCredentials({ ...CREDS, region })

    expect(seen?.url).toBe(url)
  })

  test('surfaces the JSON error field on 401 so the bind route can map it', async () => {
    stubFetch(401, '{"status":"error","error":"Unauthorized"}')

    const err = (await verifyMixpanelCredentials(CREDS).catch(
      (e: unknown) => e,
    )) as MixpanelApiError

    expect(err).toBeInstanceOf(MixpanelApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('Mixpanel API error: Unauthorized')
  })

  test('falls back to the raw body when the error is not JSON', async () => {
    stubFetch(500, 'upstream exploded')

    const err = (await verifyMixpanelCredentials(CREDS).catch(
      (e: unknown) => e,
    )) as MixpanelApiError

    expect(err.status).toBe(500)
    expect(err.message).toBe('Mixpanel API error: upstream exploded')
  })
})
