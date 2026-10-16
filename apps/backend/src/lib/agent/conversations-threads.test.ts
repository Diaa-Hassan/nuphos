import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { readableByFilter } from './db/access'
import { touchThreadAncestors } from './db/thread-activity'
import { getConversations } from './db'

import type * as dbActual from '@/lib/db'

// The sidebar lists only top-level rows and loads a row's threads when it is
// expanded. A thread whose parent the listing leaves out must stay top-level:
// the rule is "nested under a listed conversation", never "has a parent".

type Stage = Record<string, Record<string, unknown>>

let rows: Record<string, unknown>[] = []
let counts: { _id: string; count: number }[] = []
let ancestors: { sessionId: string }[] = []
let finds: Record<string, unknown>[] = []
let pipelines: Stage[][] = []
let updates: { filter: unknown; update: unknown }[] = []

const stage = (pipeline: Stage[], name: string) => pipeline.find((step) => name in step)?.[name]

const collection = {
  collectionName: 'agent_conversations',
  find(query: Record<string, unknown>) {
    finds.push(query)

    return { sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([...rows]) }) }) }
  },
  aggregate(pipeline: Stage[]) {
    pipelines.push(pipeline)
    const result = stage(pipeline, '$group')
      ? counts
      : stage(pipeline, '$graphLookup')
        ? [{ ancestors }]
        : rows

    return { toArray: () => Promise.resolve([...result]) }
  },
  updateMany(filter: unknown, update: unknown) {
    updates.push({ filter, update })

    return Promise.resolve({ modifiedCount: 1 })
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const VIEWER = '642802f4c38340345aa2384d'
const OWN_OR_SHARED = { $or: [{ userId: VIEWER }, { participantIds: VIEWER }] }

beforeEach(() => {
  rows = []
  counts = []
  ancestors = []
  finds = []
  pipelines = []
  updates = []
})

describe('getConversations threads', () => {
  test('top level drops only rows whose parent is listed, and counts threads', async () => {
    rows = [{ sessionId: 'parent' }, { sessionId: 'other' }]
    counts = [{ _id: 'parent', count: 2 }]
    const result = await getConversations(VIEWER, {
      teamId: TEAM,
      archived: 'exclude',
      threads: true,
      cursor: '2026-10-01T00:00:00.000Z',
    })
    const [top, count] = pipelines
    const lookup = stage(top!, '$lookup')!

    expect(stage(top!, '$match')).toMatchObject({
      userId: VIEWER,
      lastActiveAt: { $lt: expect.any(Date) },
    })
    expect(lookup).toMatchObject({ localField: 'parentSessionId', foreignField: 'sessionId' })
    // "Listed" is the same listing without the cursor, over own and shared chats.
    const listed = (lookup.pipeline as Stage[])[0]!.$match!

    expect(listed).toMatchObject({ teamId: TEAM, archivedAt: { $exists: false } })
    expect(listed).not.toHaveProperty('userId')
    expect(listed).not.toHaveProperty('lastActiveAt')
    expect(listed.$and).toEqual([readableByFilter(VIEWER), OWN_OR_SHARED])
    expect(top!.map((step) => Object.keys(step)[0])).toEqual([
      '$match',
      '$sort',
      '$lookup',
      '$match',
      '$limit',
      '$project',
    ])
    expect(stage(count!, '$match')).toMatchObject({
      ...listed,
      parentSessionId: { $in: ['parent', 'other'] },
    })
    expect(result.conversations.map((row) => row.threadCount)).toEqual([2, 0])
  })

  test("a row's threads are the listed ones under it, own or shared", async () => {
    rows = [{ sessionId: 'thread' }]
    await getConversations(VIEWER, { teamId: TEAM, threads: true, parentSessionId: 'parent' })
    const [query] = finds

    expect(query).toMatchObject({ teamId: TEAM, parentSessionId: 'parent' })
    expect(query).not.toHaveProperty('userId')
    expect(query?.$and).toEqual([readableByFilter(VIEWER), OWN_OR_SHARED])
  })

  test('team scope keeps the readability filter and nothing else', async () => {
    rows = [{ sessionId: 'parent' }]
    await getConversations(VIEWER, { teamId: TEAM, scope: 'team', threads: true })
    const listed = (stage(pipelines[0]!, '$lookup')!.pipeline as Stage[])[0]!.$match!

    expect(listed.$and).toEqual([readableByFilter(VIEWER)])
  })

  test('a search lists every match, nested or not', async () => {
    await getConversations(VIEWER, { teamId: TEAM, threads: true, search: 'deploy' })

    expect(finds[0]).toMatchObject({
      userId: VIEWER,
      $or: [{ title: /deploy/i }, { firstMessage: /deploy/i }],
    })
    expect(pipelines.some((pipeline) => stage(pipeline, '$lookup'))).toBe(false)
  })

  test('sessionIds fetches exactly those rows', async () => {
    await getConversations(VIEWER, { teamId: TEAM, sessionIds: ['a', 'b'] })

    expect(finds[0]).toMatchObject({ userId: VIEWER, sessionId: { $in: ['a', 'b'] } })
  })

  test('the flat list is unchanged without threads', async () => {
    rows = [{ sessionId: 'thread', parentSessionId: 'parent' }]
    const result = await getConversations(VIEWER, { teamId: TEAM })

    expect(pipelines).toEqual([])
    expect(result.conversations[0]).not.toHaveProperty('threadCount')
  })
})

describe('touchThreadAncestors', () => {
  test('raises every ancestor to the thread activity, never lowers it', async () => {
    ancestors = [{ sessionId: 'parent' }, { sessionId: 'grandparent' }]
    const now = new Date('2026-10-16T12:00:00Z')

    await touchThreadAncestors('thread', now)

    expect(stage(pipelines[0]!, '$match')).toEqual({
      sessionId: 'thread',
      parentSessionId: { $exists: true },
    })
    expect(updates).toEqual([
      {
        filter: { sessionId: { $in: ['parent', 'grandparent'] } },
        update: { $max: { lastActiveAt: now } },
      },
    ])
  })

  test('a top-level conversation writes nothing more', async () => {
    collection.aggregate = ((pipeline: Stage[]) => {
      pipelines.push(pipeline)

      return { toArray: () => Promise.resolve([]) }
    }) as typeof collection.aggregate
    await touchThreadAncestors('top', new Date())

    expect(updates).toEqual([])
  })
})
