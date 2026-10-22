import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveChatExternalLink } from './chatExternalLink.ts'

const noLookup = {
  getLinearIssue: async () => {
    throw new Error('unexpected lookup')
  },
  listLinearTeams: async () => {
    throw new Error('unexpected lookup')
  },
}
const github = '/teams/t/repository/installations/7/repos/nuphos/nuphos'
const linear = '/teams/t/linear/workspaces/b'

test('GitHub PR, repository and workflows use provider URLs', async () => {
  for (const [path, target] of [
    [`${github}/pull-requests/42`, 'https://github.com/nuphos/nuphos/pull/42'],
    [`${github}/pull-requests`, 'https://github.com/nuphos/nuphos/pulls'],
    [`${github}/workflows`, 'https://github.com/nuphos/nuphos/actions'],
  ]) {
    assert.equal(await resolveChatExternalLink(path, noLookup), target)
    assert.equal(await resolveChatExternalLink(`https://nuphos.ai${path}`, noLookup), target)
  }
})

test('Linear issue and team URLs come from the linked workspace', async () => {
  const lookups: string[][] = []
  const loaders = {
    getLinearIssue: async (...args: string[]) => {
      lookups.push(args)

      return { url: 'https://linear.app/example/issue/EX-7/title' }
    },
    listLinearTeams: async (...args: string[]) => {
      lookups.push(args)

      return { teams: [{ id: 'team1', url: 'https://linear.app/example/team/EX' }] }
    },
  }

  assert.equal(
    await resolveChatExternalLink(`${linear}/issues/EX-7`, loaders),
    'https://linear.app/example/issue/EX-7/title',
  )
  assert.equal(
    await resolveChatExternalLink(`${linear}/teams/team1`, loaders),
    'https://linear.app/example/team/EX',
  )
  assert.deepEqual(lookups, [
    ['t', 'b', 'EX-7'],
    ['t', 'b'],
  ])
})

test('native pages, unknown paths, failed lookups and missing URLs retain the app link', async () => {
  for (const path of [
    '/teams/t/agent/s',
    `${github}/unknown`,
    `${github}/pull-requests/42/unknown`,
    `${linear}/issues/EX-7`,
    `${linear}/teams/team1`,
  ]) {
    assert.equal(await resolveChatExternalLink(path, noLookup), `https://nuphos.ai${path}`)
  }
  assert.equal(
    await resolveChatExternalLink(`${linear}/teams/missing`, {
      ...noLookup,
      listLinearTeams: async () => ({ teams: [] }),
    }),
    `https://nuphos.ai${linear}/teams/missing`,
  )
})

test('external origins stay intact even with an app-looking pathname', async () => {
  const url = `https://example.com${github}/pull-requests/42`

  assert.equal(await resolveChatExternalLink(url, noLookup), url)
})
