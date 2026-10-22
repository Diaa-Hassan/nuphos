import { expect, test } from 'bun:test'

import { publicZeaburProviders } from './zeabur-provider-view'

import type { ObjectId } from 'mongodb'

const team = { zeaburId: 'team', kind: 'team' as const, name: 'Same team' }

function binding(id: string, identities?: (typeof team)[]) {
  return {
    id: { toHexString: () => id } as ObjectId,
    identities,
    createdAt: new Date('2026-10-19'),
  }
}
test('preserves first source metadata without changing stored bindings', () => {
  const bindings = [binding('first', [team]), binding('later', [{ ...team, name: 'Renamed' }])]
  const before = JSON.stringify(bindings)

  expect(publicZeaburProviders(bindings)).toEqual([
    { ...team, providerId: 'first', createdAt: new Date('2026-10-19') },
  ])
  expect(JSON.stringify(bindings)).toBe(before)
})
test('does not merge same-name different-ID identities', () => {
  expect(
    publicZeaburProviders([binding('first', [team, { ...team, zeaburId: 'another' }])]),
  ).toHaveLength(2)
})
test('surviving source supplies metadata', () => {
  expect(publicZeaburProviders([binding('later', [team])])[0]?.providerId).toBe('later')
})
test('empty and legacy bindings produce no phantom connections', () => {
  expect(publicZeaburProviders([])).toEqual([])
  expect(publicZeaburProviders([binding('empty', [])])).toEqual([])
  expect(publicZeaburProviders([binding('legacy')])).toEqual([])
})
